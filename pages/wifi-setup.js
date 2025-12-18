import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export default function WiFiSetup() {
  const router = useRouter();
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [wifiSaving, setWifiSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [useAPMode, setUseAPMode] = useState(true);
  const [apIP] = useState("192.168.4.1");
  const [staIP, setStaIP] = useState("");
  const wifiInputFocusedRef = useRef(false);

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

  // Get API URL - try multiple connection methods
  const getApiUrl = () => {
    // 1. If we have ESP32's router IP, use proxy route
    if (staIP && staIP !== "Not connected" && staIP.length > 0) {
      return `/api/proxy?ip=${staIP}`;
    }
    
    // 2. Try tunnel if configured
    const customTunnelURL = typeof window !== "undefined" ? localStorage.getItem("customTunnelURL") : null;
    if (customTunnelURL && customTunnelURL.length > 0) {
      return `/api/tunnel-proxy?endpoint=`;
    }
    
    // 3. Check environment variable for tunnel
    if (API_BASE_URL && API_BASE_URL.length > 0) {
      return `/api/tunnel-proxy?endpoint=`;
    }
    
    // 4. Fall back to AP mode (for initial setup when ESP32 not on router WiFi yet)
    return `http://${apIP}`;
  };

  // Check WiFi status from ESP32 - tries multiple connection methods
  const checkWiFiStatus = async () => {
    setStatus("🔄 Connecting to ESP32...");
    const isHTTPS = typeof window !== "undefined" && window.location.protocol === "https:";
    
    // Build list of connection methods to try (in order of preference)
    const connectionMethods = [];
    
    // 1. Try ESP32's router IP (if we already know it from previous connection)
    if (staIP && staIP !== "Not connected" && staIP.length > 0) {
      if (isHTTPS) {
        connectionMethods.push({ type: 'proxy', url: `/api/proxy?ip=${staIP}&endpoint=/data`, desc: 'router IP via proxy' });
      } else {
        connectionMethods.push({ type: 'direct', url: `http://${staIP}/data`, desc: 'router IP direct' });
      }
    }
    
    // 2. Try tunnel (if configured)
    const customTunnelURL = typeof window !== "undefined" ? localStorage.getItem("customTunnelURL") : null;
    if (customTunnelURL || (API_BASE_URL && API_BASE_URL.length > 0)) {
      connectionMethods.push({ type: 'tunnel', url: `/api/tunnel-proxy?endpoint=/data`, desc: 'tunnel' });
    }
    
    // 3. Try AP mode (for initial setup)
    if (isHTTPS) {
      connectionMethods.push({ type: 'proxy', url: `/api/proxy?ip=${apIP}&endpoint=/data`, desc: 'AP via proxy' });
    }
    connectionMethods.push({ type: 'direct', url: `http://${apIP}/data`, desc: 'AP direct' });
    
    // Try each connection method
    let lastError = null;
    for (const method of connectionMethods) {
      try {
        const res = await fetch(method.url, {
          method: "GET",
          signal: AbortSignal.timeout(5000)
        });
        
        if (res.ok) {
          const json = await res.json();
          if (json.wifiSSID !== undefined && !wifiInputFocusedRef.current) {
            setWifiSSID(json.wifiSSID || "");
          }
          if (json.staIP !== undefined) {
            const newStaIP = json.staIP || "";
            setStaIP(newStaIP);
            if (newStaIP && newStaIP.length > 0 && json.wifiConnected) {
              // WiFi is already configured and connected
              setStatus("✅ WiFi is already configured and connected");
              if (typeof window !== "undefined") {
                sessionStorage.setItem("wifiConfigured", "true");
              }
              setTimeout(() => {
                router.push("/dashboard");
              }, 2000);
              return; // Success, exit
            } else if (json.wifiSSID && json.wifiSSID.length > 0) {
              setStatus("✅ Connected to ESP32. WiFi is configured but not connected. You can update the credentials below.");
              return; // Success, exit
            } else {
              setStatus("✅ Ready! Enter your router's WiFi credentials below.");
              return; // Success, exit
            }
          } else {
            setStatus("✅ Ready! Enter your router's WiFi credentials below.");
            return; // Success, exit
          }
        }
      } catch (e) {
        lastError = e;
        // Try next method
        continue;
      }
    }
    
    // All connection methods failed
    const errorMsg = lastError?.message || String(lastError || "Connection failed");
    if (errorMsg.includes("Failed to fetch") || errorMsg.includes("Mixed Content") || errorMsg.includes("Cannot connect")) {
      setStatus("⚠️ Cannot connect to ESP32. Options:\n1. Connect to ESP32's WiFi (Solar_Capstone_Admin) and use http://192.168.4.1/wifi-setup\n2. Ensure ESP32 is powered on and connected to router WiFi\n3. Set up Cloudflare tunnel for remote access");
    } else {
      setStatus("⚠️ Cannot connect to ESP32. Please ensure ESP32 is powered on and accessible.");
    }
  };

  // Send WiFi configuration to ESP32 - tries multiple connection methods
  const sendWifiConfig = async (ssid, password) => {
    const params = new URLSearchParams({
      wifiSSID: ssid,
      wifiPassword: password || ""
    });
    
    const isHTTPS = typeof window !== "undefined" && window.location.protocol === "https:";
    
    // Build list of connection methods to try (in order of preference)
    const connectionMethods = [];
    
    // 1. Try ESP32's router IP (if we know it)
    if (staIP && staIP !== "Not connected" && staIP.length > 0) {
      if (isHTTPS) {
        connectionMethods.push({ type: 'proxy', url: `/api/proxy?ip=${staIP}&endpoint=/wifi-config` });
      } else {
        connectionMethods.push({ type: 'direct', url: `http://${staIP}/wifi-config` });
      }
    }
    
    // 2. Try tunnel (if configured)
    const customTunnelURL = typeof window !== "undefined" ? localStorage.getItem("customTunnelURL") : null;
    if (customTunnelURL || (API_BASE_URL && API_BASE_URL.length > 0)) {
      connectionMethods.push({ type: 'tunnel', url: `/api/tunnel-proxy?endpoint=/wifi-config` });
    }
    
    // 3. Try AP mode (for initial setup)
    if (isHTTPS) {
      connectionMethods.push({ type: 'proxy', url: `/api/proxy?ip=${apIP}&endpoint=/wifi-config` });
    }
    connectionMethods.push({ type: 'direct', url: `http://${apIP}/wifi-config` });
    
    // Try each connection method
    let lastError = null;
    for (const method of connectionMethods) {
      try {
        const res = await fetch(method.url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        
        if (res.ok) {
          return res;
        }
        
        // If response not OK, try to get error message
        const errorText = await res.text();
        let errorMsg = "WiFi configuration failed";
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) {
            errorMsg = errorJson.error;
          }
        } catch (e) {
          if (errorText) errorMsg = errorText;
        }
        throw new Error(errorMsg);
      } catch (e) {
        lastError = e;
        // Try next method
        continue;
      }
    }
    
    // All methods failed
    const errorMsg = lastError?.message || String(lastError || "Connection failed");
    if (errorMsg.includes("Failed to fetch") || errorMsg.includes("Mixed Content")) {
      throw new Error("Cannot connect to ESP32. For initial setup, connect to ESP32's WiFi (Solar_Capstone_Admin) and use http://192.168.4.1/wifi-setup");
    }
    throw lastError || new Error("Failed to connect to ESP32");
  };

  // Handle WiFi configuration save
  const handleSaveWifi = async () => {
    if (!wifiSSID || wifiSSID.trim().length === 0) {
      setError("Please enter a WiFi SSID (network name)");
      return;
    }
    
    if (wifiSSID.length > 32) {
      setError("WiFi SSID is too long (maximum 32 characters)");
      return;
    }
    
    if (wifiPassword.length > 64) {
      setError("WiFi password is too long (maximum 64 characters)");
      return;
    }
    
    setError("");
    setWifiSaving(true);
    setStatus("💾 Saving WiFi credentials...");
    
    try {
      await sendWifiConfig(wifiSSID.trim(), wifiPassword);
      setStatus("✅ WiFi credentials saved! ESP32 is connecting to your network. This may take 10-30 seconds...");
      
      // Poll for WiFi connection status
      let pollCount = 0;
      const maxPolls = 30;
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          await checkWiFiStatus();
          if (staIP && staIP !== "Not connected" && staIP.length > 0) {
            clearInterval(pollInterval);
            setStatus("✅ WiFi connected successfully! Redirecting to dashboard...");
            // Mark WiFi setup as complete
            if (typeof window !== "undefined") {
              sessionStorage.setItem("wifiConfigured", "true");
            }
            setTimeout(() => {
              router.push("/dashboard");
            }, 2000);
          } else if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            setStatus("⚠️ WiFi credentials saved but connection is taking longer than expected. You can proceed to dashboard.");
            if (typeof window !== "undefined") {
              sessionStorage.setItem("wifiConfigured", "true");
            }
          }
        } catch (e) {
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            setStatus("⚠️ WiFi credentials saved. You can proceed to dashboard.");
            if (typeof window !== "undefined") {
              sessionStorage.setItem("wifiConfigured", "true");
            }
          }
        }
      }, 1000);
      
    } catch (e) {
      console.error("WiFi config error:", e);
      const errorMsg = e.message || String(e);
      
      // Provide helpful error messages based on error type
      if (errorMsg.includes("Cannot connect to ESP32") || errorMsg.includes("Failed to fetch")) {
        setError("Cannot connect to ESP32. Please ensure:\n1. Your device is connected to ESP32's WiFi network (Solar_Capstone_Admin)\n2. ESP32 is powered on\n3. If accessing via HTTPS, try accessing this page via HTTP when on ESP32's network");
      } else if (errorMsg.includes("Proxy failed")) {
        setError("Connection failed. Please ensure:\n1. Your device is connected to ESP32's WiFi network (Solar_Capstone_Admin)\n2. ESP32 is powered on\n3. Try refreshing the page");
      } else {
        setError(`Failed to save WiFi credentials: ${errorMsg}`);
      }
      setStatus("");
    } finally {
      setWifiSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>WiFi Setup — Solar Tracker</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-header">
            <div className="sun"></div>
            <div className="login-title">WiFi Configuration</div>
            <div className="login-subtitle">Enter Your Router's WiFi Credentials</div>
            <div className="login-subtitle" style={{ marginTop: "4px", fontSize: "12px", opacity: 0.7 }}>
              The app will automatically configure ESP32
            </div>
          </div>

          {status && (
            <div style={{
              background: status.includes("✅") 
                ? "rgba(47, 210, 122, 0.1)" 
                : status.includes("⚠️") 
                ? "rgba(245, 179, 66, 0.1)" 
                : "rgba(47, 210, 122, 0.1)",
              border: `1px solid ${status.includes("✅") 
                ? "rgba(47, 210, 122, 0.3)" 
                : status.includes("⚠️") 
                ? "rgba(245, 179, 66, 0.3)" 
                : "rgba(47, 210, 122, 0.3)"}`,
              borderRadius: "8px",
              padding: "12px",
              marginBottom: "20px",
              color: status.includes("✅") ? "#2fd27a" : status.includes("⚠️") ? "#f5b342" : "#2fd27a",
              fontSize: "13px",
              textAlign: "center",
              lineHeight: "1.6"
            }}>
              {status}
            </div>
          )}

          {error && (
            <div className="login-error" style={{ marginBottom: "20px" }}>
              {error}
            </div>
          )}

          {status && status.includes("⚠️") && (
            <div style={{
              background: "rgba(245, 179, 66, 0.1)",
              border: "1px solid rgba(245, 179, 66, 0.3)",
              borderRadius: "8px",
              padding: "12px",
              marginBottom: "20px",
              fontSize: "12px",
              color: "var(--warn)",
              lineHeight: "1.6",
              whiteSpace: "pre-line"
            }}>
              <strong>📡 Quick Setup:</strong>
              <br />
              Connect your device to ESP32's WiFi network:
              <br />
              <strong>Network:</strong> Solar_Capstone_Admin
              <br />
              <strong>Password:</strong> 12345678
              <br />
              <br />
              Once connected, this page will automatically detect ESP32 and you can enter your router's WiFi credentials below.
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); handleSaveWifi(); }} className="login-form">
            <div className="form-group">
              <label htmlFor="wifiSSID">WiFi Network Name (SSID)</label>
              <input
                type="text"
                id="wifiSSID"
                value={wifiSSID}
                onChange={(e) => setWifiSSID(e.target.value)}
                onFocus={() => { wifiInputFocusedRef.current = true; }}
                onBlur={() => { wifiInputFocusedRef.current = false; }}
                placeholder="Enter WiFi network name"
                maxLength={32}
                required
                disabled={wifiSaving}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="wifiPassword">WiFi Password</label>
              <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  id="wifiPassword"
                  value={wifiPassword}
                  onChange={(e) => setWifiPassword(e.target.value)}
                  placeholder="Enter WiFi password (optional for open networks)"
                  maxLength={64}
                  disabled={wifiSaving}
                  style={{ paddingRight: "40px", width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
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
                    opacity: wifiSaving ? 0.5 : 1,
                    zIndex: 1
                  }}
                  disabled={wifiSaving}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
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

            <button
              type="submit"
              className="login-btn"
              disabled={wifiSaving || status.includes("⚠️")}
            >
              {wifiSaving ? "Saving WiFi Configuration..." : status.includes("⚠️") ? "Connect to ESP32 First" : "Save WiFi Configuration"}
            </button>
          </form>

          <div className="login-footer">
            <span className="muted">Enter your router's WiFi credentials. The app will automatically configure ESP32.</span>
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
        .login-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
        }
        .login-card {
          width: 100%;
          max-width: 420px;
          background: linear-gradient(180deg, #101734, #0d142b);
          border: 1px solid var(--grid);
          border-radius: 14px;
          padding: 40px 32px;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
        }
        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }
        .sun {
          width: 24px;
          height: 24px;
          background: linear-gradient(180deg, #ffd24d, #ff9a3c);
          border-radius: 50%;
          box-shadow: 0 0 24px #ffb347a0;
          margin: 0 auto 16px;
        }
        .login-title {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 0.2px;
          margin-bottom: 8px;
        }
        .login-subtitle {
          font-size: 14px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .form-group label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .form-group input {
          background: #0e1833;
          border: 1px solid var(--grid);
          border-radius: 8px;
          padding: 12px 16px;
          color: var(--ink);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }
        .form-group input:focus {
          border-color: var(--accent);
        }
        .form-group input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .login-btn {
          margin-top: 8px;
          padding: 14px;
          border-radius: 8px;
          background: linear-gradient(180deg, #2fd27a, #11a85a);
          border: none;
          color: #09151a;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        .login-btn:hover:not(:disabled) {
          opacity: 0.9;
        }
        .login-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .login-error {
          background: rgba(255, 107, 107, 0.1);
          border: 1px solid #ff6b6b;
          border-radius: 8px;
          padding: 12px;
          color: #ff6b6b;
          font-size: 13px;
          text-align: center;
        }
        .login-footer {
          margin-top: 24px;
          text-align: center;
        }
        .muted {
          color: var(--muted);
          font-size: 12px;
        }
      `}</style>
    </>
  );
}

