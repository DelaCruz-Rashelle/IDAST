import { useEffect, useState, useRef, useCallback } from "react";
import mqtt from "mqtt";
import { handleMqttError } from "../utils/errorHandler.js";

const MQTT_BROKER_URL = process.env.NEXT_PUBLIC_MQTT_BROKER_URL || "";
const MQTT_USERNAME = process.env.NEXT_PUBLIC_MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.NEXT_PUBLIC_MQTT_PASSWORD || "";

/**
 * Custom hook for MQTT connection, telemetry processing, and control commands
 * @param {Function} onTelemetryProcessed - Callback when telemetry is processed (for chart drawing)
 * @param {Function} setCurrentDevice - Setter for current device name (from device management)
 * @returns {Object} MQTT connection state and functions
 */
export function useMqttConnection(onTelemetryProcessed, setCurrentDevice) {
  const onTelemetryProcessedRef = useRef(onTelemetryProcessed);
  const setCurrentDeviceRef = useRef(setCurrentDevice);
  
  // Update refs when callbacks change
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

  // Process MQTT telemetry message
  const processTelemetryMessage = (json) => {
    setData(json);
    setError(""); // Clear error on success
    
    if (json.device_id) {
      setDeviceId(json.device_id);
    }
    
    // Update WiFi status from telemetry (read-only, for display)
    if (json.wifiSSID !== undefined) {
      setWifiSSID(json.wifiSSID);
    }
    if (json.wifiConnected !== undefined) {
      setWifiConnected(json.wifiConnected);
    }
    
    if (json.manual !== undefined) setManual(json.manual);
    // Do NOT update device name input field from telemetry
    // Only update the currentDevice display (read-only) for reference
    // The input field should only be populated by user input, not from database or telemetry
    if (json.deviceName && 
        json.deviceName.trim() !== "" &&
        json.deviceName.trim().toLowerCase() !== "unknown") {
      if (setCurrentDeviceRef.current) {
        setCurrentDeviceRef.current(json.deviceName);
      }
      // Do not update deviceName state - let user input it manually
    }
    // Never update grid price from telemetry - user must input and save manually
    // Telemetry values are ignored to prevent default values from appearing
    // Grid price should only come from database (user's saved value) or user input
    // Update tilt and pan values from telemetry (sliders are read-only, so always update)
    if (json.tiltAngle !== undefined) {
      setTiltValue(json.tiltAngle);
    }
    if (json.panTarget !== undefined) {
      setPanValue(json.panTarget);
    }
    
    // Update sensor history for chart
    if (json.top !== undefined) {
      sensorHistory.current.top.push(json.top);
      if (sensorHistory.current.top.length > 120) sensorHistory.current.top.shift();
    }
    if (json.left !== undefined) {
      sensorHistory.current.left.push(json.left);
      if (sensorHistory.current.left.length > 120) sensorHistory.current.left.shift();
    }
    if (json.right !== undefined) {
      sensorHistory.current.right.push(json.right);
      if (sensorHistory.current.right.length > 120) sensorHistory.current.right.shift();
    }
    
    // Call callback for chart drawing if provided
    if (onTelemetryProcessedRef.current) {
      onTelemetryProcessedRef.current();
    }
  };

  // Send control commands via MQTT
  const sendControl = async (params) => {
    try {
      if (!mqttClientRef.current || !mqttClientRef.current.connected) {
        throw new Error("MQTT not connected");
      }
      
      if (!deviceId) {
        throw new Error("Device ID not available");
      }
      
      const controlTopic = `solar-tracker/${deviceId}/control`;
      const controlMessage = {};
      
      if (params.newPrice !== undefined) {
        controlMessage.gridPrice = parseFloat(params.newPrice);
        if (isNaN(controlMessage.gridPrice) || controlMessage.gridPrice <= 0 || controlMessage.gridPrice >= 1000) {
          throw new Error("Invalid grid price (must be 0 to 1000)");
        }
      }
      
      if (params.deviceName !== undefined) {
        const name = String(params.deviceName).trim();
        if (name.length > 24) {
          throw new Error("Device name too long (max 24 characters)");
        }
        controlMessage.deviceName = name;
      }
      
      if (params.startCharging !== undefined) {
        controlMessage.startCharging = Boolean(params.startCharging);
      }
      
      if (Object.keys(controlMessage).length === 0) {
        throw new Error("No control parameters provided");
      }
      
      const messageStr = JSON.stringify(controlMessage);
      
      // Return a promise that resolves/rejects based on publish callback
      return new Promise((resolve, reject) => {
        const result = mqttClientRef.current.publish(controlTopic, messageStr, { qos: 1 }, (err) => {
          if (err) {
            reject(new Error(`Failed to send control command: ${err.message}`));
          } else {
            console.log(`✅ Control command published to ${controlTopic}:`, controlMessage);
            resolve();
          }
        });
        
        if (!result) {
          reject(new Error("Failed to publish control command"));
        }
      });
    } catch (error) {
      // Re-throw to be caught by caller
      throw error;
    }
  };

  // Initialize MQTT connection
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Prevent multiple simultaneous connection attempts
    if (mqttConnectingRef.current) {
      console.log("MQTT connection already in progress, skipping");
      return;
    }
    
    if (!MQTT_BROKER_URL) {
      setError("MQTT broker URL not configured. Please set NEXT_PUBLIC_MQTT_BROKER_URL in Vercel environment variables.");
      return;
    }
    
    // Prevent multiple connections
    if (mqttClientRef.current && mqttClientRef.current.connected) {
      console.log("MQTT already connected, skipping new connection");
      return;
    }
    
    // Use a stable client ID that persists across reconnects
    // Store it in sessionStorage to maintain consistency
    let clientId = sessionStorage.getItem('mqtt_client_id');
    if (!clientId) {
      clientId = `idast-dashboard-${Math.random().toString(36).substring(2, 15)}`;
      sessionStorage.setItem('mqtt_client_id', clientId);
    }
    
    const connectOptions = {
      clientId,
      clean: true,
      reconnectPeriod: 10000, // Increased to 10 seconds to prevent rapid reconnects
      connectTimeout: 15000, // Increased timeout
      keepalive: 60, // Send ping every 60 seconds
      reschedulePings: true, // Reschedule pings if connection is busy
      // WebSocket-specific options
      wsOptions: {
        // Don't reject unauthorized certificates (for EMQX Cloud)
        rejectUnauthorized: false,
        // Protocol options
        protocol: 'mqtt',
        // Additional headers if needed
        headers: {}
      },
      will: {
        topic: `solar-tracker/dashboard/${clientId}/status`,
        payload: JSON.stringify({ status: 'offline' }),
        qos: 1,
        retain: false
      }
    };
    
    if (MQTT_USERNAME && MQTT_PASSWORD) {
      connectOptions.username = MQTT_USERNAME;
      connectOptions.password = MQTT_PASSWORD;
    }
    
    console.log("Connecting to MQTT broker:", MQTT_BROKER_URL);
    mqttConnectingRef.current = true;
    
    // Define connection function
    function createMqttConnection() {
      try {
        // Ensure URL is properly formatted for WebSocket
        let brokerUrl = MQTT_BROKER_URL;
        if (brokerUrl && !brokerUrl.includes('/mqtt') && !brokerUrl.includes('/ws')) {
          // Add /mqtt path if not present (required for EMQX WebSocket)
          if (brokerUrl.endsWith('/')) {
            brokerUrl = brokerUrl + 'mqtt';
          } else {
            brokerUrl = brokerUrl + '/mqtt';
          }
        }
        
        console.log("Creating MQTT connection to:", brokerUrl);
        const client = mqtt.connect(brokerUrl, connectOptions);
        mqttClientRef.current = client;
    
        client.on("connect", () => {
          console.log("✅ MQTT connected");
          mqttConnectingRef.current = false;
          setMqttConnected(true);
          setError("");
          
          // Subscribe to all device telemetry topics
          const telemetryTopic = "solar-tracker/+/telemetry";
          client.subscribe(telemetryTopic, { qos: 1 }, (err) => {
            if (err) {
              console.error("Failed to subscribe to telemetry:", err);
              setError(`Failed to subscribe to MQTT topic: ${err.message}`);
            } else {
              console.log(`✅ Subscribed to: ${telemetryTopic}`);
            }
          });
          
          // Subscribe to status topics
          const statusTopic = "solar-tracker/+/status";
          client.subscribe(statusTopic, { qos: 1 }, (err) => {
            if (err) {
              console.error("Failed to subscribe to status:", err);
            } else {
              console.log(`✅ Subscribed to: ${statusTopic}`);
            }
          });
        });
        
        client.on("message", (topic, message) => {
          try {
            const json = JSON.parse(message.toString());
            
            if (topic.includes("/telemetry")) {
              processTelemetryMessage(json);
              // Extract device_id from telemetry for control commands
              if (json.device_id && !deviceId) {
                setDeviceId(json.device_id);
              }
            } else if (topic.includes("/status")) {
              console.log("Status update:", json);
              if (json.device_id && !deviceId) {
                setDeviceId(json.device_id);
              }
            }
          } catch (err) {
            console.error("Error parsing MQTT message:", err);
            // Don't set error state for parsing errors - just log
          }
        });
        
        client.on("error", (err) => {
          console.error("MQTT error:", err);
          mqttConnectingRef.current = false;
          // Don't call handleMqttError if it's a close-related error to avoid loops
          if (err.message && !err.message.includes("Close received after close")) {
            handleMqttError(err, setError, setMqttConnected);
          }
        });
        
        client.on("close", () => {
          console.log("MQTT connection closed");
          mqttConnectingRef.current = false;
          setMqttConnected(false);
        });
        
        client.on("reconnect", () => {
          console.log("MQTT reconnecting...");
          mqttConnectingRef.current = true;
          setMqttConnected(false);
        });
        
        client.on("offline", () => {
          console.log("MQTT offline");
          mqttConnectingRef.current = false;
          setMqttConnected(false);
        });
        
        // Handle WebSocket close errors specifically
        if (client.stream && typeof client.stream.on === 'function') {
          client.stream.on('error', (err) => {
            if (err.message && err.message.includes('Close received after close')) {
              console.warn("WebSocket close error (ignoring):", err.message);
              // Don't trigger reconnection for this specific error
              mqttConnectingRef.current = false;
              return;
            }
            console.error("WebSocket stream error:", err);
          });
          
          // Handle WebSocket close events
          client.stream.on('close', () => {
            console.log("WebSocket closed");
            mqttConnectingRef.current = false;
          });
        }
        
        // Additional error handling for connection issues
        client.on('disconnect', () => {
          console.log("MQTT disconnected");
          mqttConnectingRef.current = false;
          setMqttConnected(false);
        });
      } catch (err) {
        console.error("Error creating MQTT connection:", err);
        mqttConnectingRef.current = false;
        setError(`Failed to create MQTT connection: ${err.message}`);
      }
    }
    
    // Clean up any existing connection first with a small delay
    if (mqttClientRef.current) {
      try {
        // Remove all listeners first to prevent event handler conflicts
        mqttClientRef.current.removeAllListeners();
        mqttClientRef.current.end(true); // Force disconnect
        // Wait a bit before creating new connection
        setTimeout(() => {
          createMqttConnection();
        }, 500);
        return;
      } catch (e) {
        console.log("Error closing existing connection:", e);
        // Continue to create new connection even if cleanup failed
        createMqttConnection();
      }
    } else {
      createMqttConnection();
    }
    
    // Cleanup on unmount
    return () => {
      mqttConnectingRef.current = false;
      if (mqttClientRef.current) {
        console.log("Cleaning up MQTT connection");
        try {
          mqttClientRef.current.removeAllListeners();
          mqttClientRef.current.end(true);
        } catch (e) {
          console.log("Error during cleanup:", e);
        }
        mqttClientRef.current = null;
      }
    };
  }, []); // Empty dependency array - only run once on mount

  // Setter function to update callbacks
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
    setSetCurrentDevice
  };
}

