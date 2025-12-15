import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

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
  const [deviceIP, setDeviceIP] = useState("");
  const [ipSaving, setIpSaving] = useState(false);
  const [ipConfigured, setIpConfigured] = useState(false);
  const [showIpSetup, setShowIpSetup] = useState(false);
  const [ipEditMode, setIpEditMode] = useState(false);
  const [ipEditValue, setIpEditValue] = useState("");
  const ipInputFocusedRef = useRef(false);
  const deviceNameInputFocusedRef = useRef(false);
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiEditMode, setWifiEditMode] = useState(false);
  const [wifiEditSSID, setWifiEditSSID] = useState("");
  const [wifiEditPassword, setWifiEditPassword] = useState("");
  const [wifiSaving, setWifiSaving] = useState(false);
  const wifiInputFocusedRef = useRef(false);
  const [useAPMode, setUseAPMode] = useState(false);
  const [apIP, setApIP] = useState("192.168.4.1");
  const [staIP, setStaIP] = useState("");
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [setupStep, setSetupStep] = useState(3); // 3: Tunnel URL
  const [setupWifiSSID, setSetupWifiSSID] = useState("");
  const [setupWifiPassword, setSetupWifiPassword] = useState("");
  const [setupDeviceIP, setSetupDeviceIP] = useState("192.168.4.1");
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [tunnelURL, setTunnelURL] = useState("");
  const [customTunnelURL, setCustomTunnelURL] = useState("");
  const [tunnelEditMode, setTunnelEditMode] = useState(false);
  const [useProxyMode, setUseProxyMode] = useState(false);
  const [pendingWifiSSID, setPendingWifiSSID] = useState("");
  
  const chartRef = useRef(null);
  const historyChartRef = useRef(null);
  const sensorHistory = useRef({ top: [], left: [], right: [] });
  const gridPriceDebounceRef = useRef(null);
  const historyPointsRef = useRef([]);
  const [tooltip, setTooltip] = useState(null);

  const REPORT_END = new Date();
  const REPORT_START = new Date(REPORT_END.getTime() - 60 * 24 * 3600 * 1000);

  // Load custom tunnel URL, proxy mode, and pending WiFi settings from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTunnelURL = localStorage.getItem("customTunnelURL");
      if (savedTunnelURL) {
        setCustomTunnelURL(savedTunnelURL);
      }
      const savedProxyMode = localStorage.getItem("useProxyMode");
      if (savedProxyMode === "true") {
        setUseProxyMode(true);
      }
      const pendingSSID = localStorage.getItem("pendingWifiSSID");
      if (pendingSSID) {
        setPendingWifiSSID(pendingSSID);
      }
    }
  }, []);

  // Get the API URL (use AP mode if enabled, otherwise use proxy API or custom tunnel URL or env variable)
  const getApiUrl = () => {
    if (useAPMode) {
      return `http://${apIP}`;
    }
    
    // If we have ESP32 IP and want to use proxy mode (no manual tunnel needed)
    if (useProxyMode && staIP && staIP !== "Not connected") {
      // Use Next.js API route as proxy - ESP32 must be accessible from internet
      // This works if ESP32 has public IP or is behind a router with port forwarding
      return `/api/proxy?ip=${staIP}`;
    }
    
    // Use custom tunnel URL from localStorage if available
    if (customTunnelURL && customTunnelURL.length > 0) {
      // For custom tunnel URLs, use proxy to avoid CORS issues when deployed
      return `/api/tunnel-proxy?endpoint=`;
    }
    
    // If API_BASE_URL is set (from env), use proxy to avoid CORS issues
    if (API_BASE_URL && API_BASE_URL.length > 0) {
      return `/api/tunnel-proxy?endpoint=`;
    }
    
    return "";
  };

  // Fetch telemetry data
  const fetchData = async () => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      setError("API URL not configured. Please either:\n1. Set NEXT_PUBLIC_API_BASE_URL in Vercel environment variables, OR\n2. Connect to ESP32 Access Point and use AP mode (192.168.4.1)");
      return;
    }
    try {
      // If using proxy, append endpoint; otherwise use full URL
      const fetchUrl = apiUrl.includes('/api/') 
        ? `${apiUrl}/data` 
        : `${apiUrl}/data`;
      
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setError(""); // Clear error on success
        if (json.manual !== undefined) setManual(json.manual);
        if (json.deviceName && !deviceNameInputFocusedRef.current) {
          setCurrentDevice(json.deviceName);
          setDeviceName(json.deviceName);
        }
        if (json.gridPrice && typeof window !== "undefined" && document.activeElement?.id !== "gridPrice") {
          setGridPrice(json.gridPrice.toFixed(2));
        }
        if (json.deviceIP !== undefined) {
          const ip = json.deviceIP || "";
          // Only update deviceIP if the input field is not currently focused
          if (!ipInputFocusedRef.current) {
            setDeviceIP(ip);
          }
          const isValid = ip.length > 0 && ip !== "0.0.0.0";
          setIpConfigured(isValid);
          setShowIpSetup(!isValid);
        }
        if (json.wifiSSID !== undefined && !wifiInputFocusedRef.current) {
          setWifiSSID(json.wifiSSID || "");
        }
        if (json.staIP !== undefined) {
          setStaIP(json.staIP || "");
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
      } else {
        setError(`Backend returned ${res.status}: ${res.statusText}. Check if Cloudflare tunnel is running.`);
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      // Provide more helpful error messages
      let userFriendlyError = `Cannot connect to backend: ${errorMsg}`;
      
      // Check for pending WiFi settings and try to apply them when ESP32 becomes accessible
      if (typeof window !== "undefined") {
        const pendingSSID = localStorage.getItem("pendingWifiSSID");
        const pendingPassword = localStorage.getItem("pendingWifiPassword");
        
        if (pendingSSID && !error) {
          // Try to apply pending settings in the background
          setTimeout(async () => {
            try {
              const apiUrl = getApiUrl();
              if (apiUrl) {
                const params = { wifiSSID: pendingSSID };
                if (pendingPassword) {
                  params.wifiPassword = pendingPassword;
                }
                await sendControl(params);
                if (typeof window !== "undefined") {
                  localStorage.removeItem("pendingWifiSSID");
                  localStorage.removeItem("pendingWifiPassword");
                }
                setPendingWifiSSID("");
                setWifiSSID(pendingSSID);
                alert("✅ Pending WiFi settings have been applied to ESP32!");
              }
            } catch (e) {
              // Still can't connect, keep settings pending
            }
          }, 2000);
        }
      }
      if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("ERR_FAILED")) {
        if (!useAPMode) {
          userFriendlyError = `Cannot connect via Cloudflare tunnel. The ESP32 may not be connected to WiFi yet.

🔧 Initial Setup (First Time):
1. Connect your computer/phone to ESP32's Access Point:
   - SSID: "Solar_Capstone_Admin"
   - Password: "12345678"
2. Open browser and go to: http://192.168.4.1
3. Configure WiFi credentials in the dashboard
4. ESP32 will restart and connect to your router
5. Then set up Cloudflare tunnel for remote access

📡 Or use AP Mode (Direct Connection):
Click "Switch to AP Mode" below to connect directly via Access Point (no WiFi needed)

Current API URL: ${API_BASE_URL || "Not configured"}`;
        } else {
          userFriendlyError = `Cannot connect via Access Point. Make sure:
1. You're connected to ESP32's WiFi: "Solar_Capstone_Admin" (password: 12345678)
2. ESP32 is powered on and AP is active
3. Try accessing: http://${apIP} directly in your browser`;
        }
      } else if (errorMsg.includes("502") || errorMsg.includes("Bad Gateway")) {
        userFriendlyError = `ESP32 not reachable (502 Bad Gateway). The tunnel is running but can't reach the ESP32. Check:
1. ESP32 Serial Monitor - is it connected to Wi-Fi? (Look for "STA connected. IP: 192.168.1.X")
2. Is the tunnel pointing to the correct IP? (Should match the ESP32's STA IP)
3. Is the ESP32 web server running? (Look for "Receiver web server started")`;
      } else if (errorMsg.includes("CORS")) {
        userFriendlyError = `CORS error: The ESP32 is reachable but CORS headers are missing. This usually means the request failed before reaching the ESP32.`;
      }
      setError(userFriendlyError);
      console.error("Fetch error:", e);
      console.error("API URL:", API_BASE_URL);
    }
  };

  // Send control command
  const sendControl = async (params) => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      throw new Error("API URL not configured");
    }
    const body = new URLSearchParams(params).toString();
    
    // If using proxy, append endpoint; otherwise use full URL
    const fetchUrl = apiUrl.includes('/api/') 
      ? `${apiUrl}/control` 
      : `${apiUrl}/control`;
    
    const res = await fetch(fetchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!res.ok) throw new Error("Control command failed");
    return res;
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
    const apiUrl = getApiUrl();
    if (!apiUrl) return;
    try {
      let fetchUrl;
      
      // If using proxy mode, add endpoint as query parameter
      if (apiUrl.includes('/api/proxy')) {
        // Extract IP from existing URL and add endpoint parameter
        const urlObj = new URL(apiUrl, window.location.origin);
        urlObj.searchParams.set('endpoint', '/api/history');
        fetchUrl = urlObj.pathname + urlObj.search;
      } else if (apiUrl.includes('/api/tunnel-proxy')) {
        // For tunnel-proxy, endpoint is already a query parameter
        fetchUrl = `${apiUrl}/api/history`;
      } else {
        // Direct connection (AP mode)
        fetchUrl = `${apiUrl}/api/history`;
      }
      
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const text = await res.text();
        setHistoryData(text);
        drawHistoryChart(text);
      }
    } catch (e) {
      console.error("History fetch error:", e);
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
    // Only start fetching if authenticated
    if (typeof window !== "undefined" && sessionStorage.getItem("isAuthenticated")) {
      fetchData();
      loadHistory();
      const dataInterval = setInterval(fetchData, 350);
      const historyInterval = setInterval(loadHistory, 30000);
      return () => {
        clearInterval(dataInterval);
        clearInterval(historyInterval);
        if (gridPriceDebounceRef.current) clearTimeout(gridPriceDebounceRef.current);
      };
    }
  }, []);

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

  // Show setup wizard for tunnel information (step 3 only)
  const needsSetup = !setupComplete;

  if (showSetupWizard && needsSetup) {
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
            <span className="pill">{useAPMode ? "AP Mode" : "Tunnel"}</span>
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
            {!useAPMode && !API_BASE_URL && (
              <div style={{ marginTop: "12px" }}>
                <button
                  className="manual-btn"
                  onClick={() => {
                    setUseAPMode(true);
                    setError("");
                  }}
                  style={{ marginTop: "8px" }}
                >
                  Switch to AP Mode (Connect via Access Point)
                </button>
                <div style={{ marginTop: "8px", fontSize: "12px" }}>
                  Or configure: Go to Vercel → Project Settings → Environment Variables → Add: <code>NEXT_PUBLIC_API_BASE_URL</code> = your Cloudflare tunnel URL
                </div>
              </div>
            )}
            {useAPMode && (
              <div style={{ marginTop: "12px" }}>
                <button
                  className="manual-btn alt"
                  onClick={() => {
                    setUseAPMode(false);
                    setError("");
                  }}
                  style={{ marginTop: "8px" }}
                >
                  Switch to Tunnel Mode
                </button>
                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--muted)" }}>
                  Make sure you're connected to ESP32's WiFi: <strong>Solar_Capstone_Admin</strong> (password: 12345678)
                </div>
              </div>
            )}
            {!useAPMode && API_BASE_URL && (
              <div style={{ marginTop: "12px", padding: "12px", background: "rgba(47, 210, 122, 0.1)", border: "1px solid rgba(47, 210, 122, 0.3)", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", marginBottom: "10px", color: "var(--ink)" }}>
                  <strong>💡 Quick Fix:</strong> If ESP32 is not connected to WiFi yet, use AP Mode to configure it first.
                </div>
                <button
                  className="manual-btn"
                  onClick={() => {
                    setUseAPMode(true);
                    setError("");
                  }}
                  style={{ fontSize: "13px", padding: "10px 16px", width: "100%" }}
                >
                  🔌 Switch to AP Mode (Connect via Access Point)
                </button>
                <div style={{ marginTop: "10px", padding: "8px", background: "rgba(0,0,0,0.2)", borderRadius: "4px", fontSize: "11px", fontFamily: "monospace" }}>
                  <strong>Current API URL:</strong> {API_BASE_URL}
                  <br />
                  <strong>Note:</strong> If you restarted the Cloudflare tunnel, the URL may have changed. Update it in Vercel environment variables and redeploy.
                </div>
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
                <button
                  className={`manual-btn ${manual ? "alt" : ""}`}
                  onClick={() => {
                    const next = !manual;
                    setManual(next);
                    sendControl({ mode: next ? "manual" : "auto" });
                  }}
                >
                  {manual ? "Switch to Auto" : "Switch to Manual"}
                </button>
              </div>
              <div className="controls">
                <div className="slider-group">
                  <label htmlFor="tiltSlider">Tilt Angle</label>
                  <input
                    type="range"
                    id="tiltSlider"
                    min={data?.minTilt || 50}
                    max={data?.maxTilt || 110}
                    value={tiltValue}
                    step="1"
                    disabled={!manual}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setTiltValue(val);
                      if (manual) sendControl({ tilt: val });
                    }}
                    onMouseDown={() => setSliderActive({ ...sliderActive, tilt: true })}
                    onMouseUp={() => setSliderActive({ ...sliderActive, tilt: false })}
                  />
                  <div className="slider-footer">
                    <span>
                      Value: <span className="mono">{tiltValue}°</span>
                    </span>
                    <span>
                      {data?.minTilt || 50}°-{data?.maxTilt || 110}°
                    </span>
                  </div>
                </div>
                <div className="slider-group">
                  <label htmlFor="panSlider">Pan Angle</label>
                  <input
                    type="range"
                    id="panSlider"
                    min={data?.minPan || 50}
                    max={data?.maxPan || 130}
                    value={panValue}
                    step="1"
                    disabled={!manual}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setPanValue(val);
                      if (manual) {
                        const slider = degToSlider(val);
                        sendControl({ pan: slider });
                      }
                    }}
                    onMouseDown={() => setSliderActive({ ...sliderActive, pan: true })}
                    onMouseUp={() => setSliderActive({ ...sliderActive, pan: false })}
                  />
                  <div className="slider-footer">
                    <span>
                      Value: <span className="mono">{panValue}°</span>
                    </span>
                    <span>
                      {data?.minPan || 50}°-{data?.maxPan || 130}°
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Device Registration & Settings</h3>
            <div className="content">
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
              <button
                className="manual-btn"
                style={{ width: "100%", marginTop: "8px", marginBottom: "16px" }}
                onClick={async () => {
                  if (deviceName.trim().length > 0) {
                    try {
                      await sendControl({ deviceName: deviceName.trim() });
                      setCurrentDevice(deviceName.trim());
                      alert("✅ Charging session started for: " + deviceName.trim());
                    } catch (e) {
                      console.error("Failed to start charging session:", e);
                      alert("❌ Failed to start charging session. Please check your connection.");
                    }
                  } else {
                    alert("Please enter a device name first.");
                  }
                }}
              >
                Start Charging Session
              </button>
              <div style={{ marginBottom: "16px", fontSize: "13px", color: "var(--ink)" }}>
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
                  onBlur={handlePriceChange}
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

          <div className="card" style={{ gridColumn: "1/-1" }}>
            <h3>Monthly Report — Energy History</h3>
            <div className="content">
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
        .card {
          background: linear-gradient(180deg, #101734, #0d142b);
          border: 1px solid var(--grid);
          border-radius: 14px;
          overflow: hidden;
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
