import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export default function WiFiSetup() {
  const router = useRouter();
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
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

  // Always use AP mode for WiFi configuration (ESP32's Access Point)
  const getApiUrl = () => {
    return `http://${apIP}`;
  };

  // Check WiFi status from ESP32 (automatically tries AP mode)
  const checkWiFiStatus = async () => {
    // Always try AP mode for WiFi configuration
    const apIP = "192.168.4.1";
    setStatus("🔄 Connecting to ESP32...");
    
    try {
      const res = await fetch(`http://${apIP}/data`, {
        method: "GET",
        signal: AbortSignal.timeout(5000) // 5 second timeout
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
            // Mark as configured and redirect to dashboard after a short delay
            if (typeof window !== "undefined") {
              sessionStorage.setItem("wifiConfigured", "true");
            }
            setTimeout(() => {
              router.push("/dashboard");
            }, 2000);
          } else if (json.wifiSSID && json.wifiSSID.length > 0) {
            setStatus("✅ Connected to ESP32. WiFi is configured but not connected. You can update the credentials below.");
          } else {
            setStatus("✅ Ready! Enter your router's WiFi credentials below.");
          }
        } else {
          setStatus("✅ Ready! Enter your router's WiFi credentials below.");
        }
      } else {
        setStatus("⚠️ Cannot connect to ESP32. Please ensure ESP32 is powered on and your device is connected to ESP32's WiFi network (Solar_Capstone_Admin).");
      }
    } catch (e) {
      setStatus("⚠️ Cannot connect to ESP32. Please connect your device to ESP32's WiFi network:\nNetwork: Solar_Capstone_Admin\nPassword: 12345678\n\nThen refresh this page.");
    }
  };

  // Send WiFi configuration (always uses AP mode)
  const sendWifiConfig = async (ssid, password) => {
    // Always use AP mode for WiFi configuration
    const apIP = "192.168.4.1";
    const apiUrl = `http://${apIP}`;
    const params = new URLSearchParams({
      wifiSSID: ssid,
      wifiPassword: password || ""
    });
    
    // Direct connection to ESP32 AP
    const fetchUrl = `${apiUrl}/wifi-config`;
    
    const res = await fetch(fetchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    
    if (!res.ok) {
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
    }
    return res;
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
      setError(`Failed to save WiFi credentials: ${e.message}`);
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
              <input
                type="password"
                id="wifiPassword"
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="Enter WiFi password (optional for open networks)"
                maxLength={64}
                disabled={wifiSaving}
              />
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

