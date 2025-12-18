import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import mqtt from "mqtt";

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
  const [gridPrice, setGridPrice] = useState("12.00");
  const [currentDevice, setCurrentDevice] = useState("Unknown");
  const [sliderActive, setSliderActive] = useState({ tilt: false, pan: false });
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [mqttConnected, setMqttConnected] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const deviceNameInputFocusedRef = useRef(false);
  const mqttClientRef = useRef(null);
  
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
    
    if (json.device_id) {
      setDeviceId(json.device_id);
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
    
    if (!MQTT_BROKER_URL) {
      setError("MQTT broker URL not configured. Please set NEXT_PUBLIC_MQTT_BROKER_URL in Vercel environment variables.");
      return;
    }
    
    const clientId = `idast-dashboard-${Date.now()}`;
    const connectOptions = {
      clientId,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };
    
    if (MQTT_USERNAME && MQTT_PASSWORD) {
      connectOptions.username = MQTT_USERNAME;
      connectOptions.password = MQTT_PASSWORD;
    }
    
    console.log("Connecting to MQTT broker:", MQTT_BROKER_URL);
    const client = mqtt.connect(MQTT_BROKER_URL, connectOptions);
    mqttClientRef.current = client;
    
    client.on("connect", () => {
      console.log("✅ MQTT connected");
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
        } else if (topic.includes("/status")) {
          console.log("Status update:", json);
          if (json.device_id && !deviceId) {
            setDeviceId(json.device_id);
          }
        }
      } catch (err) {
        console.error("Error parsing MQTT message:", err);
      }
    });
    
    client.on("error", (err) => {
      console.error("MQTT error:", err);
      setError(`MQTT connection error: ${err.message}`);
      setMqttConnected(false);
    });
    
    client.on("close", () => {
      console.log("MQTT connection closed");
      setMqttConnected(false);
    });
    
    client.on("reconnect", () => {
      console.log("MQTT reconnecting...");
      setMqttConnected(false);
    });
    
    // Cleanup on unmount
    return () => {
      if (client) {
        client.end();
      }
    };
  }, []);

  // Note: Control commands are no longer supported via MQTT in this version
  // (User specified no bidirectional control needed)
  const sendControl = async (params) => {
    console.warn("Control commands not supported in MQTT mode");
    throw new Error("Control commands not available - MQTT mode is read-only");
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

      const apiUrl = getApiUrl();
      if (!apiUrl) {
        setHistoryError("API URL not configured");
        return;
      }
      
      // If using proxy mode, add endpoint as query parameter
      if (apiUrl.includes('/api/proxy')) {
        // Extract IP from existing URL and add endpoint parameter
        const urlObj = new URL(apiUrl, window.location.origin);
        urlObj.searchParams.set('endpoint', '/api/history');
        fetchUrl = urlObj.pathname + urlObj.search;
      } else if (apiUrl.includes('/api/tunnel-proxy')) {
        // For tunnel-proxy, properly set the endpoint query parameter
        const urlObj = new URL(apiUrl, window.location.origin);
        urlObj.searchParams.set('endpoint', '/api/history');
        fetchUrl = urlObj.pathname + urlObj.search;
      } else {
        // Direct connection (AP mode)
        fetchUrl = `${apiUrl}/api/history`;
      }
      
      console.log("Fetching history from:", fetchUrl);
      const res = await fetch(fetchUrl);
      
      // Check response status
      if (!res.ok) {
        const errorText = await res.text();
        setHistoryError(`History fetch failed: ${res.status} ${res.statusText}`);
        console.error("History fetch failed:", res.status, errorText);
        
        // Check if response is error JSON
        try {
          const json = JSON.parse(errorText);
          if (json.error) {
            setHistoryError(`History error: ${json.error}`);
          }
        } catch (e) {
          // Not JSON, use status text
        }
        return;
      }
      
      // Get response text
      const text = await res.text();
      const contentType = res.headers.get('content-type') || '';
      
      // Check if response is error JSON instead of CSV
      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(text);
          if (json.error) {
            setHistoryError(`History error: ${json.error}`);
            console.error("History response is error JSON:", json);
            return;
          }
        } catch (e) {
          // Not JSON, continue processing as CSV
        }
      }
      
      // Validate CSV format - check if empty or header only
      const trimmedText = text.trim();
      const headerOnly = trimmedText === "timestamp,energy_wh,battery_pct,device_name,session_min";
      
      if (!trimmedText || headerOnly) {
        // Empty or header only - this is expected initially, don't show error
        setHistoryData(text);
        console.log("History file is empty (no data logged yet)");
        return;
      }
      
      // Validate CSV has data rows
      const lines = trimmedText.split("\n").filter(l => l.trim());
      if (lines.length <= 1) {
        // Only header, no data
        setHistoryData(text);
        console.log("History file has no data rows yet");
        return;
      }
      
      // Process valid CSV
      console.log(`History loaded: ${lines.length - 1} data rows`);
      setHistoryData(text);
      drawHistoryChart(text);
      
    } catch (e) {
      const errorMsg = e.message || String(e);
      setHistoryError(`Cannot fetch history: ${errorMsg}`);
      console.error("History fetch error:", e);
      console.error("Failed URL:", fetchUrl);
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
    gridPriceDebounceRef.current = setTimeout(() => {
      const price = parseFloat(gridPrice);
      if (isNaN(price) || price <= 0 || price >= 1000) {
        alert("Invalid price (must be 0 to 1000)");
        setGridPrice("12.00");
        return;
      }
      sendControl({ newPrice: price });
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
      const historyInterval = setInterval(loadHistory, 30000);
      return () => {
        clearInterval(historyInterval);
        if (gridPriceDebounceRef.current) clearTimeout(gridPriceDebounceRef.current);
      };
    }
  }, [router]);

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
        <style jsx global>{`
          :root {
            --bg: #0b1020;
            --card: #121a33;
            --ink: #e6f0ff;
            --muted: #9fb3d1;
            --accent: #2fd27a;
            --warn: #f5b342;
            --err: #ff6b6b;
            --grid: #1b2547;
          }
          body {
            margin: 0;
            font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            background: radial-gradient(1200px 600px at 20% -10%, #18306400, #18306488), var(--bg);
            color: var(--ink);
          }
          .setup-page-wrap {
            min-height: 100vh;
            background: radial-gradient(1200px 600px at 20% -10%, #18306400, #18306488), var(--bg);
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            overflow-y: auto;
          }
          .setup-overlay {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            position: relative;
          }
          .setup-overlay::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: 
              radial-gradient(circle at 20% 30%, rgba(24, 48, 100, 0.3) 0%, transparent 50%),
              radial-gradient(circle at 80% 70%, rgba(47, 210, 122, 0.1) 0%, transparent 50%),
              var(--bg);
            backdrop-filter: blur(20px);
            z-index: -1;
          }
          .setup-card {
            max-width: 500px;
            width: 100%;
            background: linear-gradient(180deg, rgba(16, 23, 52, 0.95), rgba(13, 20, 43, 0.95));
            backdrop-filter: blur(20px);
            border: 1px solid var(--grid);
            border-radius: 14px;
            padding: 40px 32px;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(148, 163, 184, 0.1);
            position: relative;
            z-index: 1;
          }
          .setup-header {
            text-align: center;
            margin-bottom: 32px;
          }
          .setup-header .sun {
            width: 32px;
            height: 32px;
            background: linear-gradient(180deg, #ffd24d, #ff9a3c);
            border-radius: 50%;
            box-shadow: 0 0 32px #ffb347a0;
            margin: 0 auto 20px;
          }
          .setup-title {
            font-size: 28px;
            font-weight: 700;
            margin: 0 0 12px 0;
            color: #e6f0ff;
            letter-spacing: 0.2px;
          }
          .setup-subtitle {
            font-size: 14px;
            color: #9fb3d1;
            line-height: 1.6;
            margin: 0;
          }
          .setup-content {
            margin-top: 0;
          }
          .setup-form-group {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 24px;
          }
          .setup-label {
            font-size: 12px;
            color: #9fb3d1;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-bottom: 2px;
          }
          .setup-input {
            background: rgba(14, 24, 51, 0.8);
            border: 1px solid var(--grid);
            border-radius: 8px;
            padding: 14px 16px;
            color: #e6f0ff;
            font-size: 16px;
            font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
            outline: none;
            transition: all 0.2s;
            width: 100%;
            box-sizing: border-box;
          }
          .setup-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(47, 210, 122, 0.15);
            background: rgba(14, 24, 51, 0.95);
          }
          .setup-input::placeholder {
            color: #6b7a99;
          }
          .setup-hint {
            font-size: 12px;
            color: #9fb3d1;
            margin-top: 4px;
            line-height: 1.4;
            opacity: 0.8;
          }
          .setup-error {
            background: rgba(255, 107, 107, 0.15);
            border: 1px solid rgba(255, 107, 107, 0.4);
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
            color: #ff6b6b;
            font-size: 13px;
            line-height: 1.5;
          }
          .setup-button {
            width: 100%;
            padding: 14px;
            border-radius: 8px;
            background: linear-gradient(180deg, #2fd27a, #11a85a);
            border: none;
            color: #09151a;
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 8px;
          }
          .setup-button:hover:not(:disabled) {
            opacity: 0.9;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(47, 210, 122, 0.3);
          }
          .setup-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
        `}</style>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Solar Tracker — ESP32</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
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
          <div style={{
            background: "rgba(255, 107, 107, 0.1)",
            border: "1px solid #ff6b6b",
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "16px",
            color: "#ff6b6b",
            fontSize: "13px",
            lineHeight: "1.6",
            whiteSpace: "pre-line"
          }}>
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
          <div style={{
            background: "rgba(245, 179, 66, 0.1)",
            border: "1px solid #f5b342",
            borderRadius: "8px",
            padding: "12px",
            marginBottom: "16px",
            color: "#f5b342",
            fontSize: "13px"
          }}>
            <strong>⚠️ MQTT Disconnected:</strong> Attempting to reconnect...
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
                  <div className="label">Phone Use</div>
                  <div className="value">
                    {data?.phoneMinutes !== undefined ? Math.round(data.phoneMinutes) : "--"} min
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">₱ Saved</div>
                  <div className="value">
                    ₱{data?.pesos !== undefined ? data.pesos.toFixed(2) : "--"}
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Battery</div>
                  <div className="value">
                    {data?.batteryPct !== undefined ? Math.round(data.batteryPct) : "--"}%
                  </div>
                </div>
              </div>
              <div className="kpis" style={{ marginTop: "10px" }}>
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
              <div style={{ marginTop: "10px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
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
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Control disabled in MQTT mode
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
                      setDeviceName(e.target.value);
                    }}
                    placeholder="Enter device name (e.g., iPhone 15)"
                    maxLength={23}
                  />
                </div>
                <div style={{ 
                  padding: "10px", 
                  background: "rgba(47, 210, 122, 0.1)", 
                  border: "1px solid rgba(47, 210, 122, 0.3)", 
                  borderRadius: "8px",
                  marginBottom: "12px",
                  fontSize: "12px",
                  color: "var(--muted)"
                }}>
                  Device registration disabled in MQTT mode. Device name is read from telemetry.
                </div>
                <div style={{ marginBottom: "12px", fontSize: "13px", color: "var(--ink)" }}>
                  Current Device: <span className="mono" style={{ fontWeight: "600" }}>{currentDevice}</span>
                </div>
                <div className="form-group">
                  <label htmlFor="gridPrice">Batelec Grid Price (cents/kWh)</label>
                  <input
                    type="number"
                    id="gridPrice"
                    value={gridPrice}
                    onChange={(e) => {
                      setGridPrice(e.target.value);
                    }}
                    disabled={true}
                    style={{ opacity: 0.5 }}
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
              <div className="muted" style={{ marginTop: "8px" }}>
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

          <div className="card" style={{ gridColumn: "1/-1" }}>
            <h3>Monthly Report — Energy History</h3>
            <div className="content">
              {historyError && (
                <div style={{
                  background: "rgba(255, 107, 107, 0.1)",
                  border: "1px solid #ff6b6b",
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "16px",
                  color: "#ff6b6b",
                  fontSize: "13px",
                  lineHeight: "1.6"
                }}>
                  <strong>History Error:</strong> {historyError}
                </div>
              )}
              <div className="history-chart" style={{ position: "relative" }}>
                <canvas ref={historyChartRef} width={800} height={300}></canvas>
                {tooltip && (
                  <div
                    style={{
                      position: "fixed",
                      left: typeof window !== "undefined" ? Math.min(tooltip.x + 10, window.innerWidth - 220) : tooltip.x + 10,
                      top: Math.max(tooltip.y - 80, 10),
                      background: "rgba(18, 27, 51, 0.95)",
                      border: "1px solid var(--grid)",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      fontSize: "12px",
                      color: "var(--ink)",
                      pointerEvents: "none",
                      zIndex: 1000,
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
                      maxWidth: "200px",
                      backdropFilter: "blur(10px)"
                    }}
                  >
                    <div style={{ fontWeight: "600", marginBottom: "4px" }}>{tooltip.date}</div>
                    <div style={{ color: "var(--muted)", fontSize: "11px" }}>
                      {tooltip.energy} kWh · {tooltip.battery}% batt
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>
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
                className="manual-btn alt"
                style={{ marginTop: "12px", width: "100%" }}
                onClick={loadHistory}
              >
                Refresh History
              </button>
            </div>
          </div>
        </div>
        <footer>Charge phones with sunshine — savings and impact shown are based on actual tracker readings and energy estimates.</footer>
      </div>
      <style jsx global>{`
        :root {
          --bg: #0b1020;
          --card: #121a33;
          --ink: #e6f0ff;
          --muted: #9fb3d1;
          --accent: #2fd27a;
          --warn: #f5b342;
          --err: #ff6b6b;
          --grid: #1b2547;
        }
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
          background: radial-gradient(1200px 600px at 20% -10%, #18306400, #18306488), var(--bg);
          color: var(--ink);
        }
        .wrap {
          max-width: 1100px;
          margin: 32px auto;
          padding: 0 16px;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
          flex-wrap: wrap;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-left: auto;
        }
        .header-nav-link {
          color: var(--muted);
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
          transition: color 0.2s;
          padding: 6px 0;
        }
        .header-nav-link:hover {
          color: var(--accent);
        }
        .logout-btn {
          padding: 6px 12px;
          border-radius: 8px;
          background: linear-gradient(180deg, #30406d, #1f2a4a);
          border: 1px solid var(--grid);
          color: var(--muted);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .logout-btn:hover {
          background: linear-gradient(180deg, #3d4f7a, #2a3658);
          color: var(--ink);
          border-color: var(--accent);
        }
        @media (max-width: 768px) {
          .header {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-right {
            margin-left: 0;
            width: 100%;
            justify-content: flex-end;
          }
        }
        .sun {
          width: 14px;
          height: 14px;
          background: linear-gradient(180deg, #ffd24d, #ff9a3c);
          border-radius: 50%;
          box-shadow: 0 0 24px #ffb347a0;
        }
        .title {
          font-weight: 700;
          letter-spacing: 0.2px;
        }
        .grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 16px;
        }
        .right-column-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
          height: 100%;
          align-items: stretch;
        }
        .card {
          background: linear-gradient(180deg, #101734, #0d142b);
          border: 1px solid var(--grid);
          border-radius: 14px;
          overflow: hidden;
          height: fit-content;
        }
        .right-column-container > .card {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .right-column-container > .card .content {
          flex: 1;
        }
        .card h3 {
          margin: 0;
          padding: 14px 16px;
          border-bottom: 1px solid var(--grid);
          font-size: 14px;
          color: var(--muted);
        }
        .content {
          padding: 14px 16px;
        }
        .kpis {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-top: 8px;
        }
        .kpi {
          background: #0e1833;
          border: 1px solid var(--grid);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .kpi .label {
          font-size: 11px;
          color: var(--muted);
        }
        .kpi .value {
          font-size: 18px;
          font-weight: 700;
          margin-top: 4px;
        }
        .mono {
          font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
        }
        .pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 99px;
          border: 1px solid var(--grid);
          font-size: 11px;
          color: var(--muted);
        }
        .badge {
          color: #09151a;
          background: linear-gradient(180deg, #2fd27a, #11a85a);
          border: none;
          padding: 2px 8px;
          border-radius: 8px;
          font-weight: 700;
        }
        .manual-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .manual-btn {
          cursor: pointer;
          font-size: 12px;
          padding: 6px 12px;
          border-radius: 8px;
          background: linear-gradient(180deg, #2fd27a, #11a85a);
          border: none;
          color: #09151a;
          font-weight: 700;
        }
        .manual-btn.alt {
          background: linear-gradient(180deg, #30406d, #1f2a4a);
          color: var(--muted);
          border: 1px solid var(--grid);
        }
        .controls {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .slider-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .slider-group label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 600;
        }
        .slider-footer {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--muted);
        }
        input[type="range"] {
          -webkit-appearance: none;
          width: 100%;
          height: 4px;
          background: var(--grid);
          border-radius: 4px;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          box-shadow: 0 0 8px #2fd27a66;
        }
        input[type="range"]:disabled {
          opacity: 0.35;
        }
        input[type="text"],
        input[type="number"] {
          background: #0e1833;
          border: 1px solid var(--grid);
          border-radius: 8px;
          padding: 8px 12px;
          color: var(--ink);
          font-size: 13px;
          width: 100%;
        }
        input[type="text"]:focus,
        input[type="number"]:focus {
          outline: none;
          border-color: var(--accent);
        }
        .legend {
          display: flex;
          gap: 12px;
          margin-top: 10px;
          font-size: 11px;
          color: var(--muted);
        }
        .legend span {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .dot.top {
          background: #ff6b6b;
        }
        .dot.left {
          background: #2fd27a;
        }
        .dot.right {
          background: #4db5ff;
        }
        .chart {
          position: relative;
          height: 220px;
          background: linear-gradient(0deg, #0a1124, #0d1630);
          border: 1px solid var(--grid);
          border-radius: 12px;
          overflow: hidden;
        }
        .table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 6px;
        }
        .table th,
        .table td {
          border-bottom: 1px solid var(--grid);
          padding: 8px 4px;
          text-align: left;
          font-size: 13px;
        }
        .muted {
          color: var(--muted);
        }
        footer {
          margin-top: 18px;
          font-size: 12px;
          color: var(--muted);
        }
        .history-chart {
          height: 300px;
          background: linear-gradient(0deg, #0a1124, #0d1630);
          border: 1px solid var(--grid);
          border-radius: 12px;
          margin-top: 12px;
          position: relative;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 12px;
        }
        .form-group label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 600;
        }
        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        .status-card {
          background: linear-gradient(135deg, #142041, #0e1527);
          border: 1px solid var(--grid);
          border-radius: 14px;
          padding: 14px 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: 0 10px 30px #06091480;
        }
        .status-card .label {
          font-size: 11px;
          letter-spacing: 0.6px;
          color: var(--muted);
          text-transform: uppercase;
        }
        .status-card .value {
          font-size: 24px;
          font-weight: 700;
        }
        .status-card .sub {
          font-size: 12px;
          color: var(--muted);
        }
        .status-card .trend {
          font-size: 11px;
          color: #2fd27a;
          font-weight: 600;
        }
        .history-meta {
          margin-top: 12px;
          border: 1px solid var(--grid);
          border-radius: 12px;
          padding: 12px;
          background: #0e1833;
        }
        .history-meta h4 {
          margin: 0 0 6px 0;
          font-size: 13px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .history-meta ul {
          margin: 0;
          padding-left: 18px;
          font-size: 12px;
          color: var(--ink);
        }
        .peso {
          font-weight: 700;
          color: #2fd27a;
        }
      `}</style>
    </>
  );
}
