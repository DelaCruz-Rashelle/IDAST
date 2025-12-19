import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import mqtt from "mqtt";
import { handleMqttError, handleControlError, handleApiError, formatErrorMessage } from "../utils/errorHandler.js";

const MQTT_BROKER_URL = process.env.NEXT_PUBLIC_MQTT_BROKER_URL || "";
const MQTT_USERNAME = process.env.NEXT_PUBLIC_MQTT_USERNAME || "";
const MQTT_PASSWORD = process.env.NEXT_PUBLIC_MQTT_PASSWORD || "";
const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [historyData, setHistoryData] = useState("");
  const [manual, setManual] = useState(false);
  const [tiltValue, setTiltValue] = useState(90);
  const [panValue, setPanValue] = useState(90);
  const [deviceName, setDeviceName] = useState("");
  const [gridPrice, setGridPrice] = useState("");
  const [currentDevice, setCurrentDevice] = useState("Unknown");
  const [sliderActive, setSliderActive] = useState({ tilt: false, pan: false });
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [mqttConnected, setMqttConnected] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [chargingStarted, setChargingStarted] = useState(false);
  const deviceNameInputFocusedRef = useRef(false);
  const deviceNameDebounceRef = useRef(null);
  const mqttClientRef = useRef(null);
  const mqttConnectingRef = useRef(false); // Prevent multiple simultaneous connection attempts
  
  // WiFi configuration state
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiConnected, setWifiConnected] = useState(false);
  const [showWifiConfig, setShowWifiConfig] = useState(false);
  const [newWifiSSID, setNewWifiSSID] = useState("");
  const [newWifiPassword, setNewWifiPassword] = useState("");
  const [wifiConfigStatus, setWifiConfigStatus] = useState("");
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  
  // Loading state for WiFi reconnection
  const [isWaitingForReconnection, setIsWaitingForReconnection] = useState(false);
  const [reconnectionStartTime, setReconnectionStartTime] = useState(null);
  const [lastTelemetryTime, setLastTelemetryTime] = useState(null);
  const [showDashboard, setShowDashboard] = useState(false); // Start hidden, show after WiFi check
  const [savingWifiSSID, setSavingWifiSSID] = useState(""); // Store SSID being saved for loading screen
  const [needsWifiConfig, setNeedsWifiConfig] = useState(false); // Track if WiFi configuration is needed
  const [hasCheckedWifiStatus, setHasCheckedWifiStatus] = useState(false); // Track if we've checked WiFi status
  
  const chartRef = useRef(null);
  const historyChartRef = useRef(null);
  const sensorHistory = useRef({ top: [], left: [], right: [] });
  const gridPriceDebounceRef = useRef(null);
  const historyPointsRef = useRef([]);
  const [tooltip, setTooltip] = useState(null);

  const REPORT_END = new Date();
  const REPORT_START = new Date(REPORT_END.getTime() - 60 * 24 * 3600 * 1000);

  // Process MQTT telemetry message
  const processTelemetryMessage = (json) => {
    setData(json);
    setError(""); // Clear error on success
    
    // Update last telemetry time - data is available
    setLastTelemetryTime(Date.now());
    
    if (json.device_id) {
      setDeviceId(json.device_id);
    }
    
    // Update WiFi status from telemetry
    if (json.wifiSSID !== undefined) {
      setWifiSSID(json.wifiSSID);
    }
    if (json.wifiConnected !== undefined) {
      setWifiConnected(json.wifiConnected);
      
      // Check WiFi status on first telemetry after login
      if (!hasCheckedWifiStatus) {
        setHasCheckedWifiStatus(true);
        if (!json.wifiConnected) {
          // WiFi is not connected - show WiFi config UI
          setNeedsWifiConfig(true);
          setShowDashboard(false);
        } else {
          // WiFi is connected - ready to show dashboard
          setNeedsWifiConfig(false);
          setShowDashboard(true);
        }
      }
    }
    
    // If we're waiting for reconnection and data is coming, mark as ready
    if (isWaitingForReconnection && json.wifiConnected) {
      // Data is flowing and WiFi is connected - ready to show dashboard
      setTimeout(() => {
        setIsWaitingForReconnection(false);
        setNeedsWifiConfig(false);
        setShowDashboard(true);
        setWifiConfigStatus("success: ESP32 reconnected successfully! Dashboard is ready.");
      }, 2000); // Small delay to ensure stable connection
    }
    
    if (json.manual !== undefined) setManual(json.manual);
    if (json.deviceName && !deviceNameInputFocusedRef.current) {
      setCurrentDevice(json.deviceName);
      setDeviceName(json.deviceName);
    }
    if (json.gridPrice && typeof window !== "undefined" && document.activeElement?.id !== "gridPrice") {
      setGridPrice(json.gridPrice.toFixed(2));
    }
    if (!sliderActive.tilt && json.tiltAngle !== undefined) {
      setTiltValue(json.tiltAngle);
    }
    if (!sliderActive.pan && json.panTarget !== undefined) {
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
        const client = mqtt.connect(MQTT_BROKER_URL, connectOptions);
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
        // Handle WebSocket close errors specifically
        if (client.stream && typeof client.stream.on === 'function') {
          client.stream.on('error', (err) => {
            if (err.message && err.message.includes('Close received after close')) {
              console.warn("WebSocket close error (ignoring):", err.message);
              // Don't trigger reconnection for this specific error
              return;
            }
            console.error("WebSocket stream error:", err);
          });
        }
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

  // Send WiFi configuration via MQTT
  const sendWifiConfig = async (ssid, password) => {
    try {
      if (!mqttClientRef.current || !mqttClientRef.current.connected) {
        throw new Error("MQTT not connected");
      }
      
      if (!ssid || ssid.trim().length === 0) {
        throw new Error("WiFi SSID cannot be empty");
      }
      
      if (ssid.length > 32) {
        throw new Error("WiFi SSID too long (max 32 characters)");
      }
      
      if (password && password.length > 64) {
        throw new Error("WiFi password too long (max 64 characters)");
      }
      
      // Use deviceId if available, otherwise use wildcard to reach any ESP32 receiver
      // This allows WiFi config even when deviceId hasn't been received yet
      const controlTopic = deviceId 
        ? `solar-tracker/${deviceId}/control`
        : `solar-tracker/+/control`; // Wildcard - will reach all devices
      
      const controlMessage = {
        wifiSSID: ssid.trim(),
        wifiPassword: password || ""
      };
      
      const messageStr = JSON.stringify(controlMessage);
      
      return new Promise((resolve, reject) => {
        const result = mqttClientRef.current.publish(controlTopic, messageStr, { qos: 1 }, (err) => {
          if (err) {
            reject(new Error(`Failed to send WiFi config: ${err.message}`));
          } else {
            console.log(`✅ WiFi config published to ${controlTopic}`);
            if (!deviceId) {
              console.log("⚠️ Device ID not available, used wildcard topic. ESP32 should receive the message if connected to MQTT.");
            }
            resolve();
          }
        });
        
        if (!result) {
          reject(new Error("Failed to publish WiFi config"));
        }
      });
    } catch (error) {
      throw error;
    }
  };

  // Handle WiFi configuration save
  const handleSaveWifi = async () => {
    if (!newWifiSSID.trim()) {
      setWifiConfigStatus("error: Please enter WiFi network name");
      return;
    }
    
    setWifiConfigStatus("saving...");
    
    try {
      await sendWifiConfig(newWifiSSID.trim(), newWifiPassword);
      setWifiConfigStatus("success: WiFi credentials sent! Waiting for ESP32 to reconnect...");
      
      // Start waiting for reconnection - NOW show loading screen
      const savedSSID = newWifiSSID.trim();
      setIsWaitingForReconnection(true);
      setReconnectionStartTime(Date.now());
      setSavingWifiSSID(savedSSID); // Store for loading screen display
      setNeedsWifiConfig(false); // Hide WiFi config UI
      setShowDashboard(false); // Hide dashboard while reconnecting
      setNewWifiSSID("");
      setNewWifiPassword("");
      
      // Reset last telemetry time to detect when new data arrives
      setLastTelemetryTime(null);
      setHasCheckedWifiStatus(false); // Reset to check status again after reconnection
      
    } catch (error) {
      setWifiConfigStatus(`error: ${error.message}`);
      setIsWaitingForReconnection(false);
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

  // Load history
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
        }
      }
    } catch (e) {
      console.error("Failed to load device name:", e);
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
    } catch (e) {
      console.error("Failed to save device name:", e);
      // Don't show error to user - MQTT command is more important
    }
  };

  // Load grid price from database
  const loadGridPrice = async () => {
    if (!RAILWAY_API_BASE_URL) return;
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/grid-price`);
      if (res.ok) {
        const json = await res.json();
        if (json.price !== null && json.price !== undefined && typeof window !== "undefined" && document.activeElement?.id !== "gridPrice") {
          setGridPrice(json.price.toFixed(2));
        }
      }
    } catch (e) {
      console.error("Failed to load grid price:", e);
      // Don't show error to user for this - it's okay if it fails
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
    } catch (e) {
      console.error("Failed to save grid price:", e);
      // Don't show error to user - MQTT command is more important
    }
  };

  // Draw history chart
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
    
    const points = lines.map((l, idx) => {
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
        device: p[3] || "Unknown",
        date: date
      };
    });
    
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

  // Handle price change
  const handlePriceChange = () => {
    if (gridPriceDebounceRef.current) {
      clearTimeout(gridPriceDebounceRef.current);
    }
    gridPriceDebounceRef.current = setTimeout(async () => {
      try {
        const price = parseFloat(gridPrice);
        if (isNaN(price) || price <= 0 || price >= 1000) {
          setError("Invalid price (must be 0 to 1000)");
          setGridPrice("");
          return;
        }
        await sendControl({ newPrice: price });
        await saveGridPrice(price);
      } catch (error) {
        handleControlError(error, setError, "update grid price");
      }
    }, 2500);
  };

  // Check authentication on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isAuthenticated = sessionStorage.getItem("isAuthenticated");
      if (!isAuthenticated) {
        router.push("/login");
        return;
      }
    }
  }, [router]);

  useEffect(() => {
    // Only start if authenticated
    if (typeof window !== "undefined" && sessionStorage.getItem("isAuthenticated")) {
      loadHistory();
      loadDeviceName();
      loadGridPrice();
      const historyInterval = setInterval(loadHistory, 30000);
      
      // Check if we need WiFi config after MQTT connects (timeout if no telemetry)
      if (mqttConnected && !hasCheckedWifiStatus) {
        const wifiCheckTimeout = setTimeout(() => {
          // If MQTT is connected but no telemetry after 10 seconds, ESP32 likely not connected to WiFi
          if (!hasCheckedWifiStatus && !data) {
            setHasCheckedWifiStatus(true);
            setNeedsWifiConfig(true);
            setShowDashboard(false);
          }
        }, 10000); // 10 second timeout
        
        return () => {
          clearInterval(historyInterval);
          clearTimeout(wifiCheckTimeout);
          if (gridPriceDebounceRef.current) clearTimeout(gridPriceDebounceRef.current);
          if (deviceNameDebounceRef.current) clearTimeout(deviceNameDebounceRef.current);
        };
      }
      
      return () => {
        clearInterval(historyInterval);
        if (gridPriceDebounceRef.current) clearTimeout(gridPriceDebounceRef.current);
        if (deviceNameDebounceRef.current) clearTimeout(deviceNameDebounceRef.current);
      };
    }
  }, [router, mqttConnected, hasCheckedWifiStatus, data]);

  // Monitor WiFi reconnection status
  useEffect(() => {
    if (!isWaitingForReconnection) {
      // Not waiting for reconnection - show dashboard if data is available
      if (data && mqttConnected) {
        setShowDashboard(true);
      }
      return;
    }
    
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - (reconnectionStartTime || now);
      
      // Check if we've received telemetry data recently (within last 5 seconds)
      const hasRecentData = lastTelemetryTime && (now - lastTelemetryTime) < 5000;
      
      // Check if WiFi is connected (from latest telemetry)
      const isWifiConnected = wifiConnected;
      
      // If we have recent data and WiFi is connected, we're ready
      if (hasRecentData && isWifiConnected && data) {
        clearInterval(checkInterval);
        setIsWaitingForReconnection(false);
        setShowDashboard(true);
        setWifiConfigStatus("success: ESP32 reconnected successfully! Dashboard is ready.");
        return;
      }
      
      // Timeout after 60 seconds
      if (elapsed > 60000) {
        clearInterval(checkInterval);
        setIsWaitingForReconnection(false);
        setShowDashboard(true); // Show dashboard anyway
        setWifiConfigStatus("warning: Reconnection timeout. ESP32 may have fallen back to AP mode. Check device status.");
      }
    }, 1000); // Check every second
    
    return () => clearInterval(checkInterval);
  }, [isWaitingForReconnection, reconnectionStartTime, lastTelemetryTime, wifiConnected, data, mqttConnected]);

  // Determine if dashboard should be shown initially
  useEffect(() => {
    // Show dashboard if:
    // 1. We have data from ESP32
    // 2. MQTT is connected
    // 3. We're not waiting for WiFi reconnection
    // 4. WiFi is connected (or we haven't checked yet)
    // 5. We don't need WiFi configuration
    if (data && mqttConnected && !isWaitingForReconnection && !needsWifiConfig) {
      // Only show if WiFi is connected (or we haven't received WiFi status yet)
      if (hasCheckedWifiStatus && wifiConnected) {
        setShowDashboard(true);
      } else if (!hasCheckedWifiStatus) {
        // Haven't checked yet, wait for telemetry
        setShowDashboard(false);
      }
    } else if (!mqttConnected || !data) {
      // Hide dashboard if no connection or no data
      if (!isWaitingForReconnection) {
        setShowDashboard(false);
      }
    }
  }, [data, mqttConnected, isWaitingForReconnection, needsWifiConfig, hasCheckedWifiStatus, wifiConnected]);

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
  }, [historyData]);

  const mapRange = (v, inMin, inMax, outMin, outMax) => {
    if (inMax === inMin) return outMin;
    return ((v - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  };

  const degToSlider = (v) => {
    const minPan = data?.minPan || 50;
    const maxPan = data?.maxPan || 130;
    return Math.round(mapRange(v, minPan, maxPan, -100, 100));
  };

  const sliderToPan = (slider) => {
    const minPan = data?.minPan || 50;
    const maxPan = data?.maxPan || 130;
    slider = Math.max(-100, Math.min(100, slider));
    const ratio = (slider + 100) / 200;
    return Math.round(minPan + ratio * (maxPan - minPan));
  };

  const totalEnergyKWh = historyData
    ? historyData
        .trim()
        .split("\n")
        .slice(1)
        .reduce((acc, line) => {
          const parts = line.split(",");
          return acc + (parseFloat(parts[1]) || 0) / 1000.0;
        }, 0)
    : 0;

  // Loading screen component
  const LoadingScreen = ({ message, progress, isWaiting }) => {
    return (
      <div className="loading-screen">
        <div className="loading-screen-content">
          {/* Animated spinner */}
          <div className="loading-spinner" />
          
          <h2 className="loading-title">
            {message || 'Connecting...'}
          </h2>
          
          {progress && (
            <div className="loading-progress">
              {progress}
            </div>
          )}
          
          {isWaiting && (
            <div className="loading-waiting">
              This may take 10-30 seconds...
            </div>
          )}
        </div>
      </div>
    );
  };

  // Setup wizard removed - no longer needed for MQTT mode
  if (false) {
    return (
      <>
        <Head>
          <title>Device Setup — Solar Tracker</title>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
        </Head>
        <div className="setup-page-wrap">
          <div className="setup-overlay">
            <div className="setup-card">
              <div className="setup-header">
                <div className="sun"></div>
                <h2 className="setup-title">Tunnel Information</h2>
                <p className="setup-subtitle">
                  Cloudflare Tunnel Setup
                </p>
              </div>
              
              <div className="setup-content">
                {/* Tunnel Information */}
                {setupStep === 3 && (
                  <>
                    <div style={{ textAlign: "center", marginBottom: "24px" }}>
                      <div style={{ fontSize: "48px", marginBottom: "16px" }}>📡</div>
                      <h3 style={{ color: "#2fd27a", margin: "0 0 8px 0" }}>Tunnel Setup</h3>
                      <p style={{ color: "var(--muted)", fontSize: "14px" }}>
                        Configure Cloudflare tunnel for remote access
                      </p>
                    </div>
                    {staIP && staIP !== "Not connected" ? (
                      <div style={{ padding: "16px", background: "rgba(47, 210, 122, 0.1)", border: "1px solid rgba(47, 210, 122, 0.3)", borderRadius: "8px", marginBottom: "20px" }}>
                        <div style={{ fontSize: "12px", marginBottom: "8px", color: "var(--ink)", fontWeight: "600" }}>
                          📡 ESP32 WiFi IP Address:
                        </div>
                        <div className="mono" style={{ fontSize: "18px", fontWeight: "700", color: "#2fd27a", marginBottom: "12px" }}>
                          {staIP}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: "1.6" }}>
                          <strong>To set up Cloudflare tunnel, run:</strong>
                          <br />
                          <code style={{ 
                            background: "rgba(0,0,0,0.3)", 
                            padding: "8px 12px", 
                            borderRadius: "4px",
                            fontSize: "11px",
                            display: "block",
                            marginTop: "8px",
                            wordBreak: "break-all"
                          }}>
                            cloudflared tunnel --url http://{staIP}:80
                          </code>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: "16px", background: "rgba(245, 179, 66, 0.1)", border: "1px solid rgba(245, 179, 66, 0.3)", borderRadius: "8px", marginBottom: "20px" }}>
                        <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                          ⏳ Waiting for ESP32 to connect to WiFi... This may take 10-30 seconds.
                          <br />
                          <br />
                          Once connected, the IP address will appear here.
                        </div>
                      </div>
                    )}
                    <button
                      className="setup-button"
                      onClick={() => {
                        setSetupComplete(true);
                        setShowSetupWizard(false);
                      }}
                    >
                      Go to Dashboard
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Solar Tracker — ESP32</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      
      {/* WiFi Configuration Screen - Show if WiFi is not connected, we've checked status, and MQTT is connected */}
      {needsWifiConfig && !isWaitingForReconnection && mqttConnected && hasCheckedWifiStatus && (
        <div className="wifi-config-wrap">
          <div className="wifi-config-card">
            <div className="wifi-config-header">
              <div className="sun"></div>
              <div className="wifi-config-title">WiFi Configuration</div>
              <div className="wifi-config-subtitle">ESP32 Device Setup</div>
              <div className="wifi-config-subtitle" style={{ marginTop: "4px", fontSize: "12px", opacity: 0.7 }}>
                Configure WiFi credentials to connect ESP32 to your network
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleSaveWifi(); }} className="wifi-config-form">
              {wifiConfigStatus && (
                <div className={`wifi-config-${wifiConfigStatus.startsWith('error') || wifiConfigStatus.startsWith('warning') ? 'error' : 'message'}`}>
                  {wifiConfigStatus.replace(/^(error|success|warning|saving):\s*/, '')}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="wifiSSID">WiFi Network Name (SSID)</label>
                <input
                  type="text"
                  id="wifiSSID"
                  value={newWifiSSID}
                  onChange={(e) => setNewWifiSSID(e.target.value)}
                  placeholder="Enter WiFi network name"
                  maxLength={32}
                  required
                  autoFocus
                  disabled={wifiConfigStatus === 'saving...'}
                />
              </div>

              <div className="form-group">
                <label htmlFor="wifiPassword">WiFi Password</label>
                <input
                  type="password"
                  id="wifiPassword"
                  value={newWifiPassword}
                  onChange={(e) => setNewWifiPassword(e.target.value)}
                  placeholder="Enter WiFi password (if required)"
                  maxLength={64}
                  disabled={wifiConfigStatus === 'saving...'}
                />
              </div>

              <button
                type="submit"
                className="wifi-config-btn"
                disabled={!newWifiSSID.trim() || wifiConfigStatus === 'saving...'}
              >
                {wifiConfigStatus === 'saving...' ? 'Saving...' : 'Save & Connect'}
              </button>
            </form>

            <div className="wifi-config-footer">
              <span className="muted">ESP32 will reconnect to the configured WiFi network</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Loading Screen - Show when waiting for reconnection or connecting */}
      {(!showDashboard || isWaitingForReconnection) && !needsWifiConfig && (
        <LoadingScreen
          message={
            isWaitingForReconnection 
              ? "ESP32 is reconnecting to WiFi..."
              : !mqttConnected
              ? "Connecting to MQTT broker..."
              : !data || !hasCheckedWifiStatus
              ? "Waiting for device data..."
              : "Loading dashboard..."
          }
          progress={
            isWaitingForReconnection
              ? `WiFi credentials sent. ESP32 is connecting to "${savingWifiSSID || wifiSSID}"...`
              : !mqttConnected
              ? "Establishing MQTT connection..."
              : !data || !hasCheckedWifiStatus
              ? "Waiting for telemetry data from ESP32..."
              : null
          }
          isWaiting={isWaitingForReconnection}
        />
      )}
      
      {/* Main Dashboard - Only show when ready */}
      {showDashboard && !isWaitingForReconnection && !needsWifiConfig && (
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
                  sessionStorage.removeItem("isAuthenticated");
                  sessionStorage.removeItem("email");
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

        {/* WiFi Configuration Section */}
        <div className="wifi-config-section">
          <h3>WiFi Configuration</h3>
          
          {/* Current WiFi Status */}
          <div className="wifi-status-container">
            <div className="wifi-status-row">
              <div className="wifi-status-info">
                <div>
                  <strong className="wifi-status-label">Current WiFi:</strong>
                  <span className={`wifi-status-value ${!wifiConnected ? 'disconnected' : ''}`}>
                    {wifiSSID || 'Not configured'}
                  </span>
                  {wifiConnected && (
                    <span className="wifi-status-badge">✓ Connected</span>
                  )}
                  {!wifiConnected && wifiSSID && (
                    <span className="wifi-status-badge disconnected">⚠ Not connected</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowWifiConfig(!showWifiConfig)}
                className={`wifi-toggle-btn ${showWifiConfig ? 'active' : ''}`}
              >
                {showWifiConfig ? 'Cancel' : wifiSSID ? 'Change WiFi' : 'Configure WiFi'}
              </button>
            </div>
          </div>
          
          {/* WiFi Configuration Form */}
          {showWifiConfig && (
            <div className="wifi-form-container">
              <div className="wifi-form-field">
                <label className="wifi-form-label">
                  WiFi Network Name (SSID) *
                </label>
                <input
                  type="text"
                  value={newWifiSSID}
                  onChange={(e) => setNewWifiSSID(e.target.value)}
                  placeholder="Enter WiFi network name"
                  maxLength={32}
                  className="wifi-form-input"
                />
              </div>
              
              <div className="wifi-form-field">
                <label className="wifi-form-label">
                  WiFi Password
                </label>
                <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
                  <input
                    type={showWifiPassword ? "text" : "password"}
                    value={newWifiPassword}
                    onChange={(e) => setNewWifiPassword(e.target.value)}
                    placeholder="Enter WiFi password (if required)"
                    maxLength={64}
                    className="wifi-form-input"
                    style={{ paddingRight: "40px", width: "100%", boxSizing: "border-box" }}
                    disabled={wifiConfigStatus === 'saving...'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWifiPassword(!showWifiPassword)}
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted)",
                      opacity: wifiConfigStatus === 'saving...' ? 0.5 : 1,
                      zIndex: 1
                    }}
                    disabled={wifiConfigStatus === 'saving...'}
                    title={showWifiPassword ? "Hide password" : "Show password"}
                  >
                    {showWifiPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              
              {wifiConfigStatus && (
                <div className={`wifi-status-message ${
                  wifiConfigStatus.startsWith('error') ? 'error' : 
                  wifiConfigStatus.startsWith('success') ? 'success' : 
                  wifiConfigStatus.startsWith('warning') ? 'warning' : 'success'
                }`}>
                  {wifiConfigStatus.replace(/^(error|success|warning|saving):\s*/, '')}
                </div>
              )}
              
              <button
                onClick={handleSaveWifi}
                disabled={!newWifiSSID.trim() || wifiConfigStatus === 'saving...'}
                className="wifi-save-btn"
              >
                {wifiConfigStatus === 'saving...' ? 'Saving...' : 'Save & Connect'}
              </button>
              
              {!wifiConnected && (
                <div className="wifi-note">
                  <strong>Note:</strong> If ESP32 is not connected to WiFi, it cannot receive MQTT messages. 
                  For initial setup, connect to the ESP32's AP network (<code>Solar_Capstone_Admin</code>) 
                  once. After that, all WiFi configuration should be done via this deployed app.
                </div>
              )}
            </div>
          )}
        </div>

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
            <div className="card">
              <h3>Device Registration & Settings</h3>
              <div className="content" style={{ padding: "12px 14px" }}>
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

            <div className="card">
              <h3>Batelec Grid Price</h3>
              <div className="content" style={{ padding: "12px 14px" }}>
                <div className="form-group">
                  <label htmlFor="gridPrice">Grid Price (cents/kWh)</label>
                  <input
                    type="number"
                    id="gridPrice"
                    value={gridPrice}
                    onChange={(e) => {
                      setGridPrice(e.target.value);
                      handlePriceChange();
                    }}
                    placeholder="20.00"
                    step="0.01"
                    min="0"
                    max="1000"
                  />
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
                  {historyData
                    ? (() => {
                        const lines = historyData.trim().split("\n").slice(1);
                        const galaxyKWh = (
                          lines
                            .filter((l) => l.includes("Galaxy"))
                            .reduce((acc, l) => acc + (parseFloat(l.split(",")[1]) || 0) / 1000.0, 0)
                        ).toFixed(3);
                        const iphoneKWh = (
                          lines
                            .filter((l) => l.includes("iPhone"))
                            .reduce((acc, l) => acc + (parseFloat(l.split(",")[1]) || 0) / 1000.0, 0)
                        ).toFixed(3);
                        const tabletKWh = (
                          lines
                            .filter((l) => l.toLowerCase().includes("tablet"))
                            .reduce((acc, l) => acc + (parseFloat(l.split(",")[1]) || 0) / 1000.0, 0)
                        ).toFixed(3);
                        return (
                          <>
                            <li>{galaxyKWh} kWh delivered to Galaxy S24 users.</li>
                            <li>{iphoneKWh} kWh routed to iPhone 15 owners.</li>
                            <li>{tabletKWh} kWh sustaining our community tablets.</li>
                          </>
                        );
                      })()
                    : null}
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
                        {historyData
                          ? (totalEnergyKWh / Math.max(historyData.trim().split("\n").slice(1).length, 1)).toFixed(3)
                          : "0.000"}{" "}
                        kWh
                      </td>
                    </tr>
                    <tr>
                      <td>Estimated Savings</td>
                      <td>₱{(totalEnergyKWh * parseFloat(gridPrice || 12)).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td>Most Active Device</td>
                      <td>
                        {historyData
                          ? (() => {
                              const lines = historyData.trim().split("\n").slice(1);
                              const deviceEnergy = {};
                              lines.forEach((line) => {
                                const parts = line.split(",");
                                if (parts.length >= 4) {
                                  const device = parts[3] || "Unknown";
                                  const energy = parseFloat(parts[1]) || 0;
                                  deviceEnergy[device] = (deviceEnergy[device] || 0) + energy;
                                }
                              });
                              const entries = Object.entries(deviceEnergy);
                              if (entries.length === 0) return "—";
                              const mostActive = entries.reduce((max, [device, energy]) =>
                                energy > max[1] ? [device, energy] : max
                              );
                              return mostActive[0] !== "Unknown" ? mostActive[0] : "—";
                            })()
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
      )}
    </>
  );
}