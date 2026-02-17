import { useEffect, useState, useRef, useCallback } from "react";
import mqtt from "mqtt";
import { handleMqttError } from "../utils/errorHandler.js";

const MQTT_BROKER_URL = process.env.NEXT_PUBLIC_MQTT_BROKER_URL || "";
const MQTT_USERNAME = process.env.NEXT_PUBLIC_MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.NEXT_PUBLIC_MQTT_PASSWORD || "";

/**
 * MQTT connection hook (GATED)
 * @param {Function} onTelemetryProcessed
 * @param {Function} setCurrentDevice (will now represent currentSolarName display)
 * @param {boolean} enabled - only connect/subscribe/process when true
 */
export function useMqttConnection(onTelemetryProcessed, setCurrentDevice, enabled = true) {
  const onTelemetryProcessedRef = useRef(onTelemetryProcessed);
  const setCurrentDeviceRef = useRef(setCurrentDevice);

  useEffect(() => {
    onTelemetryProcessedRef.current = onTelemetryProcessed;
    setCurrentDeviceRef.current = setCurrentDevice;
  }, [onTelemetryProcessed, setCurrentDevice]);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [mqttConnected, setMqttConnected] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [manual, setManual] = useState(false);
  const [tiltValue, setTiltValue] = useState(90);
  const [panValue, setPanValue] = useState(90);
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiConnected, setWifiConnected] = useState(false);
  const [chargingStarted, setChargingStarted] = useState(false);

  const mqttClientRef = useRef(null);
  const mqttConnectingRef = useRef(false);
  const sensorHistory = useRef({ top: [], left: [], right: [] });

  const resetRealtimeState = useCallback(() => {
    setData(null);
    setDeviceId("");
    setManual(false);
    setTiltValue(90);
    setPanValue(90);
    setWifiSSID("");
    setWifiConnected(false);
    setChargingStarted(false);
    sensorHistory.current = { top: [], left: [], right: [] };
  }, []);

  const disconnectClient = useCallback(() => {
    mqttConnectingRef.current = false;
    setMqttConnected(false);
    if (mqttClientRef.current) {
      try {
        mqttClientRef.current.removeAllListeners();
        mqttClientRef.current.end(true);
      } catch (e) {
        console.log("Error during MQTT disconnect:", e);
      }
      mqttClientRef.current = null;
    }
  }, []);

  // Process MQTT telemetry message
  const processTelemetryMessage = (json) => {
    // Backward compatibility: accept deviceName as solarName
    const incomingSolarName = (json.solarName || json.deviceName || "").trim();

    // Ensure data always has solarName field for UI consistency
    const normalized = {
      ...json,
      solarName: incomingSolarName || json.solarName || json.deviceName || "",
    };

    setData(normalized);
    setError("");

    if (normalized.device_id) setDeviceId(normalized.device_id);

    if (normalized.wifiSSID !== undefined) setWifiSSID(normalized.wifiSSID);
    if (normalized.wifiConnected !== undefined) setWifiConnected(normalized.wifiConnected);

    if (normalized.manual !== undefined) setManual(normalized.manual);

    // Update read-only display name (currentSolarName)
    if (
      incomingSolarName &&
      incomingSolarName.toLowerCase() !== "unknown" &&
      setCurrentDeviceRef.current
    ) {
      setCurrentDeviceRef.current(incomingSolarName);
    }

    if (normalized.tiltAngle !== undefined) setTiltValue(normalized.tiltAngle);
    if (normalized.panTarget !== undefined) setPanValue(normalized.panTarget);

    // Sensor history
    if (normalized.top !== undefined) {
      sensorHistory.current.top.push(normalized.top);
      if (sensorHistory.current.top.length > 120) sensorHistory.current.top.shift();
    }
    if (normalized.left !== undefined) {
      sensorHistory.current.left.push(normalized.left);
      if (sensorHistory.current.left.length > 120) sensorHistory.current.left.shift();
    }
    if (normalized.right !== undefined) {
      sensorHistory.current.right.push(normalized.right);
      if (sensorHistory.current.right.length > 120) sensorHistory.current.right.shift();
    }

    if (onTelemetryProcessedRef.current) onTelemetryProcessedRef.current();
  };

  // Send control commands via MQTT
  const sendControl = async (params) => {
    if (!enabled) throw new Error("Solar not registered yet. Register Solar Name first.");
    if (!mqttClientRef.current || !mqttClientRef.current.connected) throw new Error("MQTT not connected");
    if (!deviceId) throw new Error("Device ID not available");

    const controlTopic = `solar-tracker/${deviceId}/control`;
    const controlMessage = {};

    if (params.newPrice !== undefined) {
      controlMessage.gridPrice = parseFloat(params.newPrice);
      if (isNaN(controlMessage.gridPrice) || controlMessage.gridPrice <= 0 || controlMessage.gridPrice >= 100000) {
        throw new Error("Invalid grid price (must be 0 to 100,000 cents/kWh)");
      }
    }

    // Backward compatible: still publish as "deviceName" because firmware may expect it
    if (params.deviceName !== undefined) {
      const name = String(params.deviceName).trim();
      if (name.length > 24) throw new Error("Solar name too long (max 24 characters)");
      controlMessage.deviceName = name;
      // Optional extra field if firmware later supports it
      controlMessage.solarName = name;
    }

    if (params.startCharging !== undefined) {
      controlMessage.startCharging = Boolean(params.startCharging);
    }

    if (Object.keys(controlMessage).length === 0) throw new Error("No control parameters provided");

    const messageStr = JSON.stringify(controlMessage);

    return new Promise((resolve, reject) => {
      const result = mqttClientRef.current.publish(controlTopic, messageStr, { qos: 1 }, (err) => {
        if (err) reject(new Error(`Failed to send control command: ${err.message}`));
        else {
          console.log(`✅ Control command published to ${controlTopic}:`, controlMessage);
          resolve();
        }
      });
      if (!result) reject(new Error("Failed to publish control command"));
    });
  };

  // GATED MQTT connection
  useEffect(() => {
    if (typeof window === "undefined") return;

    // If not enabled, ensure fully disconnected and cleared
    if (!enabled) {
      setError("");
      disconnectClient();
      resetRealtimeState();
      return;
    }

    // Prevent multiple simultaneous connection attempts
    if (mqttConnectingRef.current) return;

    if (!MQTT_BROKER_URL) {
      setError("MQTT broker URL not configured. Please set NEXT_PUBLIC_MQTT_BROKER_URL in Vercel environment variables.");
      return;
    }

    if (mqttClientRef.current && mqttClientRef.current.connected) return;

    // Stable client ID
    let clientId = sessionStorage.getItem("mqtt_client_id");
    if (!clientId) {
      clientId = `idast-dashboard-${Math.random().toString(36).substring(2, 15)}`;
      sessionStorage.setItem("mqtt_client_id", clientId);
    }

    const connectOptions = {
      clientId,
      clean: true,
      reconnectPeriod: 10000,
      connectTimeout: 15000,
      keepalive: 60,
      reschedulePings: true,
      wsOptions: {
        rejectUnauthorized: false,
        protocol: "mqtt",
        headers: {},
      },
      will: {
        topic: `solar-tracker/dashboard/${clientId}/status`,
        payload: JSON.stringify({ status: "offline" }),
        qos: 1,
        retain: false,
      },
    };

    if (MQTT_USERNAME && MQTT_PASSWORD) {
      connectOptions.username = MQTT_USERNAME;
      connectOptions.password = MQTT_PASSWORD;
    }

    mqttConnectingRef.current = true;

    function createMqttConnection() {
      try {
        let brokerUrl = MQTT_BROKER_URL;
        if (brokerUrl && !brokerUrl.includes("/mqtt") && !brokerUrl.includes("/ws")) {
          brokerUrl = brokerUrl.endsWith("/") ? brokerUrl + "mqtt" : brokerUrl + "/mqtt";
        }

        const client = mqtt.connect(brokerUrl, connectOptions);
        mqttClientRef.current = client;

        client.on("connect", () => {
          mqttConnectingRef.current = false;
          setMqttConnected(true);
          setError("");

          const telemetryTopic = "solar-tracker/+/telemetry";
          client.subscribe(telemetryTopic, { qos: 1 }, (err) => {
            if (err) setError(`Failed to subscribe to MQTT topic: ${err.message}`);
          });

          const statusTopic = "solar-tracker/+/status";
          client.subscribe(statusTopic, { qos: 1 }, () => {});
        });

        client.on("message", (topic, message) => {
          try {
            const json = JSON.parse(message.toString());

            if (topic.includes("/telemetry")) {
              processTelemetryMessage(json);
              if (json.device_id && !deviceId) setDeviceId(json.device_id);
            }
          } catch (err) {
            console.error("Error parsing MQTT message:", err);
          }
        });

        client.on("error", (err) => {
          mqttConnectingRef.current = false;
          if (err.message && !err.message.includes("Close received after close")) {
            handleMqttError(err, setError, setMqttConnected);
          }
        });

        client.on("close", () => {
          mqttConnectingRef.current = false;
          setMqttConnected(false);
        });

        client.on("reconnect", () => {
          mqttConnectingRef.current = true;
          setMqttConnected(false);
        });

        client.on("offline", () => {
          mqttConnectingRef.current = false;
          setMqttConnected(false);
        });

        if (client.stream && typeof client.stream.on === "function") {
          client.stream.on("error", (err) => {
            if (err.message && err.message.includes("Close received after close")) {
              mqttConnectingRef.current = false;
              return;
            }
            console.error("WebSocket stream error:", err);
          });
          client.stream.on("close", () => {
            mqttConnectingRef.current = false;
          });
        }
      } catch (err) {
        mqttConnectingRef.current = false;
        setError(`Failed to create MQTT connection: ${err.message}`);
      }
    }

    // Close existing then connect
    if (mqttClientRef.current) {
      try {
        mqttClientRef.current.removeAllListeners();
        mqttClientRef.current.end(true);
        setTimeout(createMqttConnection, 500);
      } catch (e) {
        createMqttConnection();
      }
    } else {
      createMqttConnection();
    }

    return () => {
      disconnectClient();
    };
  }, [enabled, disconnectClient, resetRealtimeState]);

  const setOnTelemetryProcessed = useCallback((callback) => {
    onTelemetryProcessedRef.current = callback;
  }, []);

  const setSetCurrentDevice = useCallback((callback) => {
    setCurrentDeviceRef.current = callback;
  }, []);

  return {
    data,
    mqttConnected,
    deviceId,
    error,
    setError,
    manual,
    tiltValue,
    panValue,
    wifiSSID,
    wifiConnected,
    chargingStarted,
    setChargingStarted,
    sendControl,
    sensorHistory,
    setOnTelemetryProcessed,
    setSetCurrentDevice,
  };
}