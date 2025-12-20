import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import mqtt from "mqtt";
import { handleMqttError, handleControlError, handleApiError } from "../utils/errorHandler.js";

const MQTT_BROKER_URL = process.env.NEXT_PUBLIC_MQTT_BROKER_URL || "";
const MQTT_USERNAME = process.env.NEXT_PUBLIC_MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.NEXT_PUBLIC_MQTT_PASSWORD || "";
const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState("");
  const [deviceStatsData, setDeviceStatsData] = useState(null); // Device statistics from API
  const [manual, setManual] = useState(false);
  const [tiltValue, setTiltValue] = useState(90);
  const [panValue, setPanValue] = useState(90);
  const [deviceName, setDeviceName] = useState("");
  const [gridPrice, setGridPrice] = useState("");
  const [savedGridPrice, setSavedGridPrice] = useState(null); // Track saved price for calculations
  const [currentDevice, setCurrentDevice] = useState("Unknown");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [mqttConnected, setMqttConnected] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [chargingStarted, setChargingStarted] = useState(false);
  const [registeredDevices, setRegisteredDevices] = useState([]);
  const [saveStateStatus, setSaveStateStatus] = useState({ loading: false, success: false, error: null });
  const deviceNameInputFocusedRef = useRef(false);
  const deviceNameDebounceRef = useRef(null);
  const deviceNameLoadedFromDbRef = useRef(false);
  const gridPriceInputFocusedRef = useRef(false);
  const gridPriceLoadedFromDbRef = useRef(false);
  const mqttClientRef = useRef(null);
  const mqttConnectingRef = useRef(false); // Prevent multiple simultaneous connection attempts
  
  // WiFi status (read-only, for display only)
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiConnected, setWifiConnected] = useState(false);
  
  const chartRef = useRef(null);
  const historyChartRef = useRef(null);
  const sensorHistory = useRef({ top: [], left: [], right: [] });
  const historyPointsRef = useRef([]);
  const [tooltip, setTooltip] = useState(null);

  const REPORT_END = new Date();
  const REPORT_START = new Date(REPORT_END.getTime() - 60 * 24 * 3600 * 1000);

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
      setCurrentDevice(json.deviceName);
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
    drawSensorGraph();
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



  // Draw sensor graph
  const drawSensorGraph = () => {
    if (!chartRef.current) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const sensors = ["top", "left", "right"];
    const colors = { top: "#ff6b6b", left: "#2fd27a", right: "#4db5ff" };
    
    sensors.forEach(sensor => {
      const history = sensorHistory.current[sensor];
      if (history.length === 0) return;
      
      ctx.beginPath();
      ctx.strokeStyle = colors[sensor];
      ctx.lineWidth = 2;
      history.forEach((val, idx) => {
        const x = idx * (canvas.width / 120);
        const y = canvas.height - (val / 4095) * canvas.height;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  };

  // Load history CSV for graph display
  const loadHistory = async () => {
    setHistoryError(""); // Clear previous errors
    let fetchUrl = ""; // Declare outside try for error logging
    try {
      // Prefer Railway DB-backed history if configured (keeps realtime via ESP32 tunnel unchanged)
      if (RAILWAY_API_BASE_URL) {
        const base = RAILWAY_API_BASE_URL.endsWith("/")
          ? RAILWAY_API_BASE_URL.slice(0, -1)
          : RAILWAY_API_BASE_URL;
        fetchUrl = `${base}/api/history.csv?days=60`;
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const text = await res.text();
          setHistoryData(text);
          drawHistoryChart(text);
        } else {
          const errorText = await res.text();
          // Try to parse as JSON to get detailed error message
          let errorMsg = `Railway history fetch failed: ${res.status} ${res.statusText}`;
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.error) {
              errorMsg = `Railway history error: ${errorJson.error}`;
            }
          } catch (e) {
            // Not JSON, use the text as-is
            if (errorText && errorText.trim()) {
              errorMsg = `Railway history error: ${errorText.substring(0, 200)}`;
            }
          }
          setHistoryError(errorMsg);
          console.error("Railway history fetch failed:", res.status, errorText);
        }
        return;
      }

      // If Railway API is not configured, show error
      const errorMsg = "Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.";
      handleApiError(new Error(errorMsg), setHistoryError, "load history");
      console.error("Railway API base URL not configured");
      
    } catch (e) {
      const errorMsg = e.message || String(e);
      handleApiError(new Error(errorMsg), setHistoryError, "fetch history");
      console.error("History fetch error:", e);
      console.error("Failed URL:", fetchUrl);
    }
  };

  // Load device statistics from device table for Monthly Report calculations
  const loadDeviceStats = async () => {
    try {
      if (!RAILWAY_API_BASE_URL) {
        console.log("[Device Stats] API not configured");
        return; // API not configured
      }

      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      
      const res = await fetch(`${base}/api/device-stats?days=60`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          console.log("[Device Stats] Loaded:", json.deviceStats?.length || 0, "devices");
          setDeviceStatsData(json);
        } else {
          console.error("[Device Stats] API returned error:", json);
        }
      } else {
        const errorText = await res.text();
        console.error("[Device Stats] Failed to load:", res.status, errorText);
      }
    } catch (e) {
      console.error("[Device Stats] Fetch error:", e);
    }
  };

  // Load device name from database
  const loadDeviceName = async () => {
    if (!RAILWAY_API_BASE_URL) return;
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/device`);
      if (res.ok) {
        const json = await res.json();
        if (json.device_name && !deviceNameInputFocusedRef.current) {
          setDeviceName(json.device_name);
          setCurrentDevice(json.device_name);
          deviceNameLoadedFromDbRef.current = true; // Mark that we've loaded from DB
        }
      }
    } catch (e) {
      console.error("Failed to load device name:", e);
      // Don't show error to user for this - it's okay if it fails
    }
  };

  // Load all registered devices from database
  const loadRegisteredDevices = async () => {
    if (!RAILWAY_API_BASE_URL) return;
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/devices`);
      if (res.ok) {
        const json = await res.json();
        if (json.devices && Array.isArray(json.devices)) {
          // Extract device_name from objects or use strings directly
          const deviceNames = json.devices.map(device => 
            typeof device === 'string' ? device : (device.device_name || device)
          ).filter(name => name && name.trim() !== '');
          console.log("[Registered Devices] Loaded:", deviceNames.length, "devices:", deviceNames);
          setRegisteredDevices(deviceNames);
        }
      }
    } catch (e) {
      console.error("Failed to load registered devices:", e);
      // Don't show error to user for this - it's okay if it fails
    }
  };

  // Save device name to database
  const saveDeviceName = async (name) => {
    if (!RAILWAY_API_BASE_URL) return;
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_name: name.trim() })
      });
      if (!res.ok) {
        throw new Error(`Failed to save device name: ${res.status} ${res.statusText}`);
      }
      // Mark that we've saved to DB, so telemetry won't overwrite it
      deviceNameLoadedFromDbRef.current = true;
      // Refresh registered devices list after saving
      await loadRegisteredDevices();
    } catch (e) {
      console.error("Failed to save device name:", e);
      // Don't show error to user - MQTT command is more important
    }
  };

  // Load grid price from database
  const loadGridPrice = async () => {
    if (!RAILWAY_API_BASE_URL) return;
    
    // Don't load if user is currently typing in the input field
    if (typeof window !== "undefined" && 
        (document.activeElement?.id === "gridPrice" || gridPriceInputFocusedRef.current)) {
      return;
    }
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/grid-price`);
      if (res.ok) {
        const json = await res.json();
        // Only update if input is not focused and not already loaded from DB (user might have typed something)
        if (json.price !== null && json.price !== undefined && 
            typeof window !== "undefined" && 
            document.activeElement?.id !== "gridPrice" &&
            !gridPriceInputFocusedRef.current &&
            !gridPriceLoadedFromDbRef.current) {
          const price = json.price.toFixed(2);
          setGridPrice(price);
          setSavedGridPrice(parseFloat(price)); // Set saved price for calculations
          gridPriceLoadedFromDbRef.current = true; // Mark that we've loaded from DB
        } else if (json.price === null || json.price === undefined) {
          // No saved price, but only clear if user hasn't typed anything
          if (!gridPriceInputFocusedRef.current && gridPrice === "") {
            setGridPrice("");
            gridPriceLoadedFromDbRef.current = false; // Allow user to input
          }
        }
      } else {
        // API call failed, but only clear if user hasn't typed anything
        if (!gridPriceInputFocusedRef.current && gridPrice === "") {
          setGridPrice("");
          gridPriceLoadedFromDbRef.current = false;
        }
      }
    } catch (e) {
      console.error("Failed to load grid price:", e);
      // Don't show error to user for this - it's okay if it fails
      // Only clear if user hasn't typed anything
      if (!gridPriceInputFocusedRef.current && gridPrice === "") {
        setGridPrice("");
        gridPriceLoadedFromDbRef.current = false;
      }
    }
  };

  // Save grid price to database
  const saveGridPrice = async (price) => {
    if (!RAILWAY_API_BASE_URL) return;
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/grid-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: parseFloat(price) })
      });
      if (!res.ok) {
        throw new Error(`Failed to save grid price: ${res.status} ${res.statusText}`);
      }
      // Mark that we've saved to DB, so telemetry won't overwrite it
      gridPriceLoadedFromDbRef.current = true;
    } catch (e) {
      console.error("Failed to save grid price:", e);
      throw e; // Re-throw so caller can handle error
    }
  };

  // Save device state to database (manual save from dashboard)
  const saveDeviceState = async () => {
    if (!RAILWAY_API_BASE_URL) {
      setSaveStateStatus({ loading: false, success: false, error: "API URL not configured" });
      return;
    }

    if (!data) {
      setSaveStateStatus({ loading: false, success: false, error: "No telemetry data available" });
      return;
    }

    // Get device name from current state or input field
    const currentDeviceName = deviceName.trim() || currentDevice || "Unknown";
    if (currentDeviceName === "Unknown" || !currentDeviceName) {
      setSaveStateStatus({ loading: false, success: false, error: "Device name is required" });
      return;
    }

    // Get current telemetry values
    const energyWh = data.energyWh !== undefined && data.energyWh !== null ? data.energyWh : null;
    const batteryPct = data.batteryPct !== undefined && data.batteryPct !== null ? data.batteryPct : null;

    if (energyWh === null && batteryPct === null) {
      setSaveStateStatus({ loading: false, success: false, error: "No energy or battery data to save" });
      return;
    }

    setSaveStateStatus({ loading: true, success: false, error: null });

    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/device-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_name: currentDeviceName,
          energy_wh: energyWh,
          battery_pct: batteryPct
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to save device state: ${res.status} ${res.statusText} - ${errorText}`);
      }

      setSaveStateStatus({ loading: false, success: true, error: null });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveStateStatus({ loading: false, success: false, error: null });
      }, 3000);
    } catch (e) {
      console.error("Failed to save device state:", e);
      setSaveStateStatus({ loading: false, success: false, error: e.message || "Failed to save device state" });
      
      // Clear error message after 5 seconds
      setTimeout(() => {
        setSaveStateStatus({ loading: false, success: false, error: null });
      }, 5000);
    }
  };

  // Draw history chart (filtered to registered devices only)
  const drawHistoryChart = (csvData) => {
    if (!historyChartRef.current || !csvData) return;
    const canvas = historyChartRef.current;
    const ctx = canvas.getContext("2d");
    const w = canvas.width - 40;
    const h = canvas.height - 40;
    
    ctx.fillStyle = "#0e1833";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const lines = csvData.trim().split("\n").slice(1).filter(l => l);
    if (lines.length === 0) return;
    
    // Parse all points first
    const allPoints = lines.map((l, idx) => {
      const p = l.split(",");
      const timestamp = parseInt(p[0]) || 0;
      // Handle both Unix timestamps (seconds) and millis timestamps
      // If timestamp is less than 1e10, it's likely in seconds, multiply by 1000
      // If timestamp is very large (> 1e12), it's already in milliseconds
      let date;
      if (timestamp > 1e12) {
        // Already in milliseconds
        date = new Date(timestamp);
      } else if (timestamp > 1e9) {
        // Unix timestamp in seconds, convert to milliseconds
        date = new Date(timestamp * 1000);
      } else {
        // Likely millis since boot, use relative date (days ago based on index)
        const daysAgo = lines.length - idx - 1;
        date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      }
      return {
        index: idx,
        timestamp: timestamp,
        energyWh: parseFloat(p[1]) || 0,
        battery: parseFloat(p[2]) || 0,
        device: (p[3] || "Unknown").trim(),
        date: date
      };
    });
    
    // Filter to only registered devices (or show all if no devices registered yet)
    const points = registeredDevices.length > 0
      ? allPoints.filter(p => registeredDevices.includes(p.device))
      : allPoints;
    
    if (points.length === 0) {
      // No data for registered devices, show message
      ctx.fillStyle = "#9fb3d1";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No energy data for registered devices", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "left";
      ctx.fillText("Energy Harvested (kWh)", 20, 20);
      ctx.textAlign = "right";
      ctx.fillText("Time →", canvas.width - 20, canvas.height - 10);
      historyPointsRef.current = [];
      return;
    }
    
    points.forEach(p => { p.energyKWh = p.energyWh / 1000.0; });
    const maxEnergyKWh = Math.max(...points.map(p => p.energyKWh), 0.001);
    
    // Store points with screen coordinates for hover detection
    historyPointsRef.current = points.map((p, i) => {
      const x = 20 + (i / (points.length - 1 || 1)) * w;
      const y = 20 + h - (p.energyKWh / maxEnergyKWh) * h;
      return {
        ...p,
        screenX: x,
        screenY: y
      };
    });
    
    ctx.strokeStyle = "#2fd27a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    historyPointsRef.current.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.screenX, p.screenY);
      else ctx.lineTo(p.screenX, p.screenY);
    });
    ctx.stroke();
    
    ctx.fillStyle = "#2fd27a";
    historyPointsRef.current.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.screenX, p.screenY, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    
    ctx.fillStyle = "#9fb3d1";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Energy Harvested (kWh)", 20, 20);
    ctx.textAlign = "right";
    ctx.fillText("Time →", canvas.width - 20, canvas.height - 10);
  };

  // Handle grid price save
  const handleSaveGridPrice = async () => {
    try {
      const price = parseFloat(gridPrice);
      if (isNaN(price) || price <= 0 || price >= 1000) {
        setError("Invalid price (must be 0 to 1000)");
        setGridPrice("");
        return;
      }
      await sendControl({ newPrice: price });
      await saveGridPrice(price);
      setSavedGridPrice(price); // Mark as saved for calculations
      setError("");
      
      // Auto-scroll to Estimated Savings section after saving
      setTimeout(() => {
        const estimatedSavingsElement = document.getElementById("estimated-savings-row");
        if (estimatedSavingsElement) {
          estimatedSavingsElement.scrollIntoView({ 
            behavior: "smooth", 
            block: "center" 
          });
        }
      }, 100); // Small delay to ensure state update is reflected
    } catch (error) {
      handleControlError(error, setError, "save grid price");
    }
  };

  // Check authentication on mount and handle input field persistence
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isAuthenticated = sessionStorage.getItem("isAuthenticated");
      if (!isAuthenticated) {
        router.push("/login");
        return;
      }

      // Always start with empty fields - do not restore from sessionStorage
      // Fields should only be populated by user input, not from previous sessions
      setDeviceName("");
      setGridPrice("");
      sessionStorage.removeItem("deviceNameInput");
      sessionStorage.removeItem("gridPriceInput");
      sessionStorage.removeItem("isPageRefresh");
    }
  }, [router]);

  // Handle tab/browser close: clear input values
  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleBeforeUnload = () => {
        // Clear the refresh flag and input values when tab/browser closes
        sessionStorage.removeItem("isPageRefresh");
        sessionStorage.removeItem("deviceNameInput");
        sessionStorage.removeItem("gridPriceInput");
      };

      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener("pagehide", handleBeforeUnload);

      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
        window.removeEventListener("pagehide", handleBeforeUnload);
      };
    }
  }, []);

  useEffect(() => {
    // Only start if authenticated
    if (typeof window !== "undefined" && sessionStorage.getItem("isAuthenticated")) {
      loadHistory();
      loadDeviceStats(); // Load device statistics for Monthly Report
      loadRegisteredDevices();
      
      // Do NOT load device name or grid price from database
      // Fields should start empty on new session and only be populated by user input
      // On refresh, sessionStorage values are already restored in the auth check useEffect
      
      const historyInterval = setInterval(loadHistory, 30000);
      const deviceStatsInterval = setInterval(loadDeviceStats, 30000); // Refresh device stats every 30 seconds
      const devicesInterval = setInterval(loadRegisteredDevices, 60000); // Refresh every minute
      
      return () => {
        clearInterval(historyInterval);
        clearInterval(deviceStatsInterval);
        clearInterval(devicesInterval);
        if (deviceNameDebounceRef.current) clearTimeout(deviceNameDebounceRef.current);
      };
    }
  }, [router, mqttConnected]); // Removed 'data' dependency to prevent reloading on every telemetry update

  useEffect(() => {
    if (typeof window !== "undefined" && chartRef.current) {
      const canvas = chartRef.current;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width || 720;
        canvas.height = 210;
        drawSensorGraph();
      }
    }
  }, [data]);

  useEffect(() => {
    if (typeof window !== "undefined" && historyChartRef.current) {
      const canvas = historyChartRef.current;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width || 800;
        canvas.height = 300;
        if (historyData) drawHistoryChart(historyData);
      }
      
      // Add mouse event handlers for tooltip
      const handleMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Find closest point within 10px radius
        let closestPoint = null;
        let minDist = Infinity;
        
        historyPointsRef.current.forEach((point) => {
          const dist = Math.sqrt(Math.pow(x - point.screenX, 2) + Math.pow(y - point.screenY, 2));
          if (dist < 10 && dist < minDist) {
            minDist = dist;
            closestPoint = point;
          }
        });
        
        if (closestPoint) {
          const dateStr = closestPoint.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          setTooltip({
            x: e.clientX,
            y: e.clientY,
            date: dateStr,
            energy: closestPoint.energyKWh.toFixed(3),
            battery: closestPoint.battery.toFixed(1),
            device: closestPoint.device
          });
        } else {
          setTooltip(null);
        }
      };
      
      const handleMouseLeave = () => {
        setTooltip(null);
      };
      
      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mouseleave", handleMouseLeave);
      
      return () => {
        canvas.removeEventListener("mousemove", handleMouseMove);
        canvas.removeEventListener("mouseleave", handleMouseLeave);
      };
    }
  }, [historyData, registeredDevices]);


  // Calculate total energy for registered devices only (fallback - will be overridden by API data)
  const totalEnergyKWhFallback = historyData
    ? (() => {
        const lines = historyData.trim().split("\n").slice(1);
        if (registeredDevices.length === 0) {
          // If no registered devices, show all data
          return lines.reduce((acc, line) => {
            const parts = line.split(",");
            return acc + (parseFloat(parts[1]) || 0) / 1000.0;
          }, 0);
        }
        // Filter to registered devices only
        return lines.reduce((acc, line) => {
          const parts = line.split(",");
          const device = (parts[3] || "Unknown").trim();
          if (registeredDevices.includes(device)) {
            return acc + (parseFloat(parts[1]) || 0) / 1000.0;
          }
          return acc;
        }, 0);
      })()
    : 0;

  // Calculate device statistics from history data, filtered to registered devices only (fallback - will be overridden by API data)
  const deviceStatsFallback = historyData
    ? (() => {
        const lines = historyData.trim().split("\n").slice(1);
        const stats = {};
        
        lines.forEach((line) => {
          const parts = line.split(",");
          if (parts.length >= 4) {
            const device = (parts[3] || "Unknown").trim();
            const energyWh = parseFloat(parts[1]) || 0;
            const energyKWh = energyWh / 1000.0;
            const battery = parseFloat(parts[2]) || 0;
            const timestamp = parseInt(parts[0]) || 0;
            
            // Skip "Unknown" devices and only include registered devices
            if (device === "Unknown" || device === "" || !registeredDevices.includes(device)) return;
            
            if (!stats[device]) {
              stats[device] = {
                name: device,
                totalEnergyKWh: 0,
                totalEnergyWh: 0,
                sessionCount: 0,
                avgBattery: 0,
                batterySum: 0,
                batteryCount: 0,
                firstSeen: timestamp,
                lastSeen: timestamp
              };
            }
            
            stats[device].totalEnergyWh += energyWh;
            stats[device].totalEnergyKWh += energyKWh;
            stats[device].sessionCount += 1;
            
            if (!isNaN(battery) && battery > 0) {
              stats[device].batterySum += battery;
              stats[device].batteryCount += 1;
            }
            
            if (timestamp > 0) {
              if (stats[device].firstSeen === 0 || timestamp < stats[device].firstSeen) {
                stats[device].firstSeen = timestamp;
              }
              if (timestamp > stats[device].lastSeen) {
                stats[device].lastSeen = timestamp;
              }
            }
          }
        });
        
        // Calculate averages
        Object.values(stats).forEach((stat) => {
          if (stat.batteryCount > 0) {
            stat.avgBattery = stat.batterySum / stat.batteryCount;
          }
        });
        
        // Convert to array and sort by total energy (descending)
        return Object.values(stats)
          .sort((a, b) => b.totalEnergyKWh - a.totalEnergyKWh)
          .slice(0, 10); // Top 10 devices
      })()
    : [];

  // Use device statistics from API (fetched directly from device table)
  // This overrides the historyData-based calculations above
  const totalEnergyKWhFromAPI = deviceStatsData?.totalEnergyKWh || 0;
  const avgPerDayFromAPI = deviceStatsData?.avgPerDay || 0;
  
  // Filter device stats to registered devices only
  // If no registered devices, show all devices with data
  const deviceStatsFromAPI = deviceStatsData?.deviceStats 
    ? deviceStatsData.deviceStats.filter(stat => {
        // If no registered devices, show all devices
        if (registeredDevices.length === 0) {
          return true;
        }
        // Otherwise, only show registered devices
        return registeredDevices.includes(stat.name);
      })
    : [];

  // Use API data if available, otherwise fall back to historyData calculations
  const totalEnergyKWh = totalEnergyKWhFromAPI > 0 ? totalEnergyKWhFromAPI : totalEnergyKWhFallback;
  const avgPerDay = avgPerDayFromAPI > 0 ? avgPerDayFromAPI : (historyData ? (totalEnergyKWhFallback / Math.max(historyData.trim().split("\n").slice(1).length, 1)) : 0);
  const deviceStats = deviceStatsFromAPI.length > 0 ? deviceStatsFromAPI : deviceStatsFallback;



  return (
    <>
      <Head>
        <title>Solar Tracker — ESP32</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      
      {/* Main Dashboard */}
      <div className="wrap">
        <div className="header">
          <div className="header-left">
            <div className="sun"></div>
            <div className="title">Solar Tracker Telemetry</div>
            <span className="pill">{mqttConnected ? "MQTT Connected" : "MQTT Disconnected"}</span>
            <span className="pill">{data ? "Online" : "Offline"}</span>
          </div>
          <div className="header-right">
            <button
              className="logout-btn"
              onClick={() => {
                if (typeof window !== "undefined") {
                  // Clear authentication and input field data on logout
                  sessionStorage.removeItem("isAuthenticated");
                  sessionStorage.removeItem("email");
                  sessionStorage.removeItem("isPageRefresh");
                  sessionStorage.removeItem("deviceNameInput");
                  sessionStorage.removeItem("gridPriceInput");
                  // Clear input fields
                  setDeviceName("");
                  setGridPrice("");
                  router.push("/login");
                }
              }}
              title="Logout"
            >
              Logout
            </button>
          </div>
        </div>
        {error && (
          <div className="error-message">
            <strong>Connection Error:</strong> {error}
            {!MQTT_BROKER_URL && (
              <div style={{ marginTop: "12px", fontSize: "12px" }}>
                Configure MQTT: Go to Vercel → Project Settings → Environment Variables → Add:
                <br />
                <code>NEXT_PUBLIC_MQTT_BROKER_URL</code> = wss://your-emqx-instance:8084/mqtt
                <br />
                <code>NEXT_PUBLIC_MQTT_USERNAME</code> = your-username (optional)
                <br />
                <code>NEXT_PUBLIC_MQTT_PASSWORD</code> = your-password (optional)
              </div>
            )}
          </div>
        )}
        
        {!mqttConnected && MQTT_BROKER_URL && (
          <div className="warning-message">
            <strong>⚠️ MQTT Disconnected:</strong> Attempting to reconnect...
          </div>
        )}

        {/* WiFi Status Display (Read-only) */}
        {wifiSSID && (
          <div className="wifi-config-section">
            <h3>WiFi Status</h3>
            <div className="wifi-status-container">
              <div className="wifi-status-row">
                <div className="wifi-status-info">
                  <div>
                    <strong className="wifi-status-label">Current WiFi:</strong>
                    <span className={`wifi-status-value ${!wifiConnected ? 'disconnected' : ''}`}>
                      {wifiSSID}
                    </span>
                    {wifiConnected && (
                      <span className="wifi-status-badge">✓ Connected</span>
                    )}
                    {!wifiConnected && (
                      <span className="wifi-status-badge disconnected">⚠ Not connected</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {!wifiConnected && (
              <div className="wifi-note" style={{ marginTop: '15px' }}>
                <strong>Note:</strong> ESP32 is not connected to WiFi. To configure WiFi, connect to the ESP32's AP network 
                (<code>Solar_Capstone_Admin</code>, password: <code>12345678</code>) and visit <code>http://192.168.4.1/wifi-setup</code>
              </div>
            )}
          </div>
        )}

        <div className="status-grid">
          <div className="status-card">
            <div className="label">Site Summary</div>
            <div className="value">
              {REPORT_START.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} –{" "}
              {REPORT_END.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div className="sub">Continuous tracking and charging sessions</div>
            <div className="trend">Live telemetry every 0.35s</div>
          </div>
          <div className="status-card">
            <div className="label">Energy Harvested</div>
            <div className="value">
              <span className="peso">{totalEnergyKWh.toFixed(3)} kWh</span>
            </div>
            <div className="sub">Cumulative energy delivered to connected devices</div>
            <div className="trend">Goal: 0.150 kWh by end of month</div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <h3>Realtime Tracker Telemetry</h3>
            <div className="content">
              <div className="kpis">
                <div className="kpi">
                  <div className="label">Panel Power</div>
                  <div className="value">
                    {data?.powerW !== undefined ? data.powerW.toFixed(2) : "--"} W
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Energy</div>
                  <div className="value">
                    {data?.energyKWh !== undefined ? data.energyKWh.toFixed(3) : "--"} kWh
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Phones Charged</div>
                  <div className="value">
                    {data?.phones !== undefined ? data.phones.toFixed(2) : "--"}
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Battery</div>
                  <div className="value">
                    {data?.batteryPct !== undefined ? Math.round(data.batteryPct) : "--"}%
                  </div>
                </div>
              </div>
              <div style={{ marginTop: "16px", marginBottom: "16px" }}>
                <button
                  onClick={saveDeviceState}
                  disabled={saveStateStatus.loading || !data}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: saveStateStatus.loading ? "#6c757d" : (saveStateStatus.success ? "#28a745" : "#007bff"),
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: saveStateStatus.loading || !data ? "not-allowed" : "pointer",
                    fontSize: "14px",
                    fontWeight: "500",
                    opacity: saveStateStatus.loading || !data ? 0.6 : 1
                  }}
                  title={!data ? "No telemetry data available" : "Save current device state to database"}
                >
                  {saveStateStatus.loading ? "Saving..." : saveStateStatus.success ? "✓ Saved" : "Save Device State"}
                </button>
                {saveStateStatus.error && (
                  <div style={{ marginTop: "8px", color: "#dc3545", fontSize: "12px" }}>
                    {saveStateStatus.error}
                  </div>
                )}
                {saveStateStatus.success && !saveStateStatus.error && (
                  <div style={{ marginTop: "8px", color: "#28a745", fontSize: "12px" }}>
                    Device state saved successfully
                  </div>
                )}
              </div>
              <div className="kpis mt-10">
                <div className="kpi">
                  <div className="label">Battery V</div>
                  <div className="value">
                    {data?.batteryV !== undefined ? data.batteryV.toFixed(2) : "--"} V
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Efficiency</div>
                  <div className="value">
                    {data?.efficiency !== undefined ? data.efficiency.toFixed(1) : "--"}%
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Panel Temp</div>
                  <div className="value">
                    {data?.tempC !== undefined ? data.tempC.toFixed(1) : "--"} °C
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">State</div>
                  <div className="value">
                    {data?.steady ? "Locked" : data ? "Tracking" : "--"}
                  </div>
                </div>
              </div>
              <div className="flex-row mt-10">
                <span className="mono">
                  Tilt: {data?.tiltAngle !== undefined ? data.tiltAngle : "--"}°
                </span>
                <span className="mono">
                  Pan Cmd: {data?.panCmd !== undefined ? data.panCmd : "--"}
                </span>
                <span className="mono">
                  H.Err: {data?.horizontalError !== undefined ? data.horizontalError : "--"}
                </span>
                <span className="mono">
                  V.Err: {data?.verticalError !== undefined ? data.verticalError : "--"}
                </span>
              </div>
              <div className="chart">
                <canvas ref={chartRef} width={720} height={210}></canvas>
              </div>
              <div className="legend">
                <span>
                  <span className="dot top"></span>Top
                </span>
                <span>
                  <span className="dot left"></span>Left
                </span>
                <span>
                  <span className="dot right"></span>Right
                </span>
              </div>
              <div className="manual-header">
                <span className="pill">{manual ? "Manual Control" : "Auto Tracking"}</span>
                <div className="muted" style={{ fontSize: "12px" }}>
                  Servo control disabled (read-only mode). Grid price and device name can be edited below.
                </div>
              </div>
              <div className="controls">
                <div className="slider-group">
                  <label htmlFor="tiltSlider">Tilt Angle (Read-only)</label>
                  <input
                    type="range"
                    id="tiltSlider"
                    min={50}
                    max={110}
                    value={tiltValue}
                    step="1"
                    disabled={true}
                    style={{ opacity: 0.5 }}
                  />
                  <div className="slider-footer">
                    <span>
                      Value: <span className="mono">{tiltValue}°</span>
                    </span>
                    <span>50°-110°</span>
                  </div>
                </div>
                <div className="slider-group">
                  <label htmlFor="panSlider">Pan Angle (Read-only)</label>
                  <input
                    type="range"
                    id="panSlider"
                    min={50}
                    max={130}
                    value={panValue}
                    step="1"
                    disabled={true}
                    style={{ opacity: 0.5 }}
                  />
                  <div className="slider-footer">
                    <span>
                      Value: <span className="mono">{panValue}°</span>
                    </span>
                    <span>50°-130°</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="right-column-container">
            <div className="card card-auto-fit">
              <h3>Device Registration & Settings</h3>
              <div className="content" style={{ padding: "12px 14px 16px 14px" }}>
                <div className="form-group">
                  <label htmlFor="deviceName">Device Name</label>
                  <input
                    type="text"
                    id="deviceName"
                    value={deviceName}
                    onFocus={() => { deviceNameInputFocusedRef.current = true; }}
                    onBlur={() => {
                      deviceNameInputFocusedRef.current = false;
                    }}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setDeviceName(newName);
                      // Save to sessionStorage for refresh persistence
                      if (typeof window !== "undefined") {
                        sessionStorage.setItem("deviceNameInput", newName);
                      }
                      // Debounce device name change
                      if (deviceNameDebounceRef.current) {
                        clearTimeout(deviceNameDebounceRef.current);
                      }
                      deviceNameDebounceRef.current = setTimeout(async () => {
                        if (newName.trim().length > 0 && newName.trim().length <= 24) {
                          try {
                            await sendControl({ deviceName: newName.trim() });
                            await saveDeviceName(newName.trim());
                          } catch (error) {
                            handleControlError(error, setError, "update device name");
                          }
                        }
                      }, 1000);
                    }}
                    placeholder="Enter device name (e.g., iPhone 15)"
                    maxLength={24}
                  />
                </div>
                <div className="mb-12" style={{ fontSize: "13px" }}>
                  Current Device: <span className="mono fw-600">{currentDevice}</span>
                </div>
                <button
                  className="manual-btn full-width mt-8"
                  onClick={async () => {
                    try {
                      // Save device name to database if it's been entered
                      if (deviceName && deviceName.trim().length > 0 && deviceName.trim().length <= 24) {
                        const trimmedName = deviceName.trim();
                        await saveDeviceName(trimmedName);
                        // Update currentDevice state immediately so it doesn't revert to "Unknown"
                        setCurrentDevice(trimmedName);
                        // Also send device name via MQTT to ensure it's synced
                        await sendControl({ deviceName: trimmedName });
                      }
                      // Send start charging command
                      await sendControl({ startCharging: true });
                      setChargingStarted(true);
                      setError("");
                    } catch (error) {
                      handleControlError(error, setError, "start charging");
                    }
                  }}
                  disabled={!mqttConnected || !deviceId}
                >
                  {chargingStarted ? "Charging Started ✓" : "Start Charging"}
                </button>
              </div>
            </div>

            <div className="card card-auto-fit">
              <h3>Batelec Grid Price</h3>
              <div className="content" style={{ padding: "12px 14px 16px 14px" }}>
                <div className="form-group">
                  <label htmlFor="gridPrice">Grid Price (cents/kWh)</label>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="number"
                      id="gridPrice"
                      value={gridPrice || ""}
                      onFocus={() => { 
                        gridPriceInputFocusedRef.current = true; 
                      }}
                      onBlur={() => {
                        gridPriceInputFocusedRef.current = false;
                      }}
                      onChange={(e) => {
                        // Prevent telemetry from interfering while user is typing
                        const newValue = e.target.value;
                        setGridPrice(newValue);
                        // Save to sessionStorage for refresh persistence
                        if (typeof window !== "undefined") {
                          sessionStorage.setItem("gridPriceInput", newValue);
                        }
                        // Mark that user is actively editing, so telemetry won't overwrite
                        if (newValue !== "") {
                          gridPriceLoadedFromDbRef.current = true;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleSaveGridPrice();
                        }
                      }}
                      placeholder="Enter price (e.g., 20.00)"
                      step="0.01"
                      min="0"
                      max="1000"
                      style={{ flex: "1", minWidth: "0" }}
                    />
                    <button
                      className="manual-btn"
                      onClick={handleSaveGridPrice}
                      disabled={!mqttConnected || !deviceId || !gridPrice || isNaN(parseFloat(gridPrice)) || parseFloat(gridPrice) <= 0 || parseFloat(gridPrice) >= 1000}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      Estimate Savings
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Actual Sensors & Servo</h3>
              <div className="content">
              <table className="table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Top</td>
                    <td className="mono">{data?.top !== undefined ? data.top : "--"}</td>
                  </tr>
                  <tr>
                    <td>Left</td>
                    <td className="mono">{data?.left !== undefined ? data.left : "--"}</td>
                  </tr>
                  <tr>
                    <td>Right</td>
                    <td className="mono">{data?.right !== undefined ? data.right : "--"}</td>
                  </tr>
                  <tr>
                    <td>Average</td>
                    <td className="mono">{data?.avg !== undefined ? data.avg : "--"}</td>
                  </tr>
                </tbody>
              </table>
              <div className="muted mt-8">
                Actual Power Estimate: <span className="mono">{data?.powerActualW !== undefined ? data.powerActualW.toFixed(2) : "--"}</span> W
              </div>
              <div className="muted">
                Model Tilt: <span className="mono">{data?.simTilt !== undefined ? data.simTilt : "--"}</span>° | Model H.Err:{" "}
                <span className="mono">{data?.simHErr !== undefined ? data.simHErr : "--"}</span> | Model V.Err:{" "}
                <span className="mono">{data?.simVErr !== undefined ? data.simVErr : "--"}</span>
              </div>
            </div>
          </div>
          </div>

          <div className="card grid-full">
            <h3>Monthly Report — Energy History</h3>
            <div className="content">
              {historyError && (
                <div className="history-error">
                  <strong>History Error:</strong> {historyError}
                </div>
              )}
              <div className="history-chart relative">
                <canvas ref={historyChartRef} width={800} height={300}></canvas>
                {tooltip && (
                  <div
                    className="tooltip"
                    style={{
                      left: typeof window !== "undefined" ? Math.min(tooltip.x + 10, window.innerWidth - 220) : tooltip.x + 10,
                      top: Math.max(tooltip.y - 80, 10)
                    }}
                  >
                    <div className="tooltip-title">{tooltip.date}</div>
                    <div className="tooltip-text">
                      {tooltip.energy} kWh · {tooltip.battery}% batt
                    </div>
                    <div className="tooltip-text" style={{ marginTop: "2px" }}>
                      {tooltip.device}
                    </div>
                  </div>
                )}
              </div>
              <div className="history-meta">
                <h4>Device highlights (rolling 60 days)</h4>
                <ul id="historyHighlights">
                  {deviceStats.length > 0 ? (
                    deviceStats.map((stat, idx) => {
                      const firstDate = stat.firstSeen > 0 
                        ? new Date(stat.firstSeen > 1e12 ? stat.firstSeen : stat.firstSeen * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—";
                      const lastDate = stat.lastSeen > 0
                        ? new Date(stat.lastSeen > 1e12 ? stat.lastSeen : stat.lastSeen * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—";
                      return (
                        <li key={idx} style={{ marginBottom: "8px" }}>
                          <strong>{stat.name}</strong> — {stat.totalEnergyKWh.toFixed(3)} kWh total
                          {stat.sessionCount > 0 && (
                            <span className="muted" style={{ fontSize: "12px", display: "block", marginTop: "2px" }}>
                              {stat.sessionCount} session{stat.sessionCount !== 1 ? "s" : ""} · 
                              {stat.avgBattery > 0 && ` Avg battery: ${stat.avgBattery.toFixed(1)}% ·`}
                              {" "}First seen: {firstDate} · Last seen: {lastDate}
                            </span>
                          )}
                        </li>
                      );
                    })
                  ) : (
                    <li className="muted" style={{ fontStyle: "italic" }}>
                      {(() => {
                        // Debug: log what we have
                        if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
                          console.log("[Device Highlights Debug]", {
                            deviceStatsData: deviceStatsData,
                            deviceStatsFromAPI: deviceStatsFromAPI,
                            deviceStatsFallback: deviceStatsFallback,
                            deviceStats: deviceStats,
                            registeredDevices: registeredDevices
                          });
                        }
                        
                        if (deviceStatsData && deviceStatsData.deviceStats && deviceStatsData.deviceStats.length > 0) {
                          // We have data from API but it's being filtered out
                          if (registeredDevices.length > 0) {
                            return "No energy data for registered devices. Try registering the devices shown in the API response.";
                          }
                          return "No device highlights available. Check console for debug info.";
                        }
                        
                        if (registeredDevices.length > 0) {
                          return "No energy data for registered devices in the last 60 days. Start charging to track energy delivery.";
                        }
                        return "No device highlights available yet. Register a device to start tracking energy delivery.";
                      })()}
                    </li>
                  )}
                </ul>
                <table className="table" id="historySummary" style={{ marginTop: "8px" }}>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Total Energy</td>
                      <td>{totalEnergyKWh.toFixed(3)} kWh</td>
                    </tr>
                    <tr>
                      <td>Average per Day</td>
                      <td>
                        {avgPerDay > 0 ? avgPerDay.toFixed(3) : "0.000"} kWh
                      </td>
                    </tr>
                    <tr id="estimated-savings-row">
                      <td>Estimated Savings</td>
                      <td>
                        {savedGridPrice !== null
                          ? `₱${(totalEnergyKWh * savedGridPrice).toFixed(2)}`
                          : "— (Save grid price to calculate)"}
                      </td>
                    </tr>
                    <tr>
                      <td>Most Active Device</td>
                      <td>
                        {deviceStats.length > 0
                          ? deviceStats[0].name
                          : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <button
                className="manual-btn alt mt-12 full-width"
                onClick={loadHistory}
              >
                Refresh History
              </button>
            </div>
          </div>
        </div>
        <footer>Charge phones with sunshine — savings and impact shown are based on actual tracker readings and energy estimates.</footer>
      </div>
    </>
  );
}