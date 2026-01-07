import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { handleControlError } from "../utils/errorHandler.js";
import { useMqttConnection } from "../hooks/useMqttConnection.js";
import { useDeviceManagement } from "../hooks/useDeviceManagement.js";
import { useGridPrice } from "../hooks/useGridPrice.js";
import { useHistoryData } from "../hooks/useHistoryData.js";
import { useCharts } from "../hooks/useCharts.js";
import { useEnergyCalculations } from "../hooks/useEnergyCalculations.js";

const MQTT_BROKER_URL = process.env.NEXT_PUBLIC_MQTT_BROKER_URL || "";

export default function Home() {
  const router = useRouter();
  const [startChargingLoading, setStartChargingLoading] = useState(false);

  const REPORT_END = new Date();
  const REPORT_START = new Date(REPORT_END.getTime() - 60 * 24 * 3600 * 1000);

  // Initialize hooks in proper dependency order
  // 1. MQTT connection hook (callbacks will be set up after other hooks)
  const mqtt = useMqttConnection(null, null);
  
  // 2. Device management hook with MQTT dependencies
  const {
    deviceName,
    setDeviceName,
    currentDevice,
    setCurrentDevice,
    registeredDevices,
    deviceNameInputFocusedRef,
    deviceNameDebounceRef,
    deviceNameLoadedFromDbRef,
    loadDeviceName,
    loadRegisteredDevices,
    saveDeviceName
  } = useDeviceManagement(mqtt.data, mqtt.sendControl);
  
  // 3. Grid price hook (needs sendControl and setError from MQTT)
  const gridPrice = useGridPrice(mqtt.sendControl, mqtt.setError);
  
  // 4. History data hook (callback will be set up after charts hook)
  const historyData = useHistoryData(null);
  
  // 5. Charts hook (needs sensorHistory, historyData, registeredDevices, and data)
  const charts = useCharts(
    mqtt.sensorHistory,
    historyData.historyData,
    registeredDevices,
    mqtt.data
  );
  
  // 6. Energy calculations hook
  const { totalEnergyKWh, avgPerDay, deviceStats } = useEnergyCalculations(
    historyData.historyData,
    historyData.deviceStatsData,
    registeredDevices
  );
  
  // Set up callbacks after all hooks are initialized
  useEffect(() => {
    // Update MQTT hook callbacks
    if (mqtt.setSetCurrentDevice) {
      mqtt.setSetCurrentDevice(setCurrentDevice);
    }
    if (mqtt.setOnTelemetryProcessed) {
      mqtt.setOnTelemetryProcessed(() => {
        if (charts.drawSensorGraph) {
          charts.drawSensorGraph();
        }
      });
    }
    // Note: History chart drawing is handled by useCharts useEffect watching historyData
    // No need for callback mechanism - it would cause duplicate drawing
  }, [setCurrentDevice, mqtt.setSetCurrentDevice, mqtt.setOnTelemetryProcessed, charts.drawSensorGraph]);


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
      gridPrice.setGridPrice("");
      sessionStorage.removeItem("deviceNameInput");
      sessionStorage.removeItem("gridPriceInput");
      sessionStorage.removeItem("isPageRefresh");
    }
  }, [router, setDeviceName, gridPrice.setGridPrice]);

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

  // Load data on mount (no automatic polling - data only updates when user saves)
  useEffect(() => {
    // Only start if authenticated
    if (typeof window !== "undefined" && sessionStorage.getItem("isAuthenticated")) {
      // Stagger initial requests to avoid ERR_INSUFFICIENT_RESOURCES
      // Load history first (most important) - only once on mount
      historyData.loadHistory();
      
      // Load device stats after a short delay - only once on mount
      const deviceStatsTimeout = setTimeout(() => {
        historyData.loadDeviceStats();
      }, 500);
      
      // Load registered devices after another delay - only once on mount
      const devicesTimeout = setTimeout(() => {
        loadRegisteredDevices();
      }, 1000);
      
      // Do NOT load device name or grid price from database
      // Fields should start empty on new session and only be populated by user input
      // On refresh, sessionStorage values are already restored in the auth check useEffect
      
      // NOTE: No automatic polling intervals - data only updates when:
      // - User clicks "Refresh History" button
      // - User saves device state
      // - User saves grid price
      // This prevents ERR_INSUFFICIENT_RESOURCES and unnecessary API calls
      
      return () => {
        if (deviceNameDebounceRef.current) clearTimeout(deviceNameDebounceRef.current);
        clearTimeout(deviceStatsTimeout);
        clearTimeout(devicesTimeout);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount - functions are memoized in hooks



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
            <span className="pill">{mqtt.mqttConnected ? "MQTT Connected" : "MQTT Disconnected"}</span>
            <span className="pill">{mqtt.data ? "Online" : "Offline"}</span>
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
                  gridPrice.setGridPrice("");
                  router.push("/login");
                }
              }}
              title="Logout"
            >
              Logout
            </button>
          </div>
        </div>
        {mqtt.error && (
          <div className="error-message">
            <strong>Connection Error:</strong> {mqtt.error}
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
        
        {!mqtt.mqttConnected && MQTT_BROKER_URL && (
          <div className="warning-message">
            <strong>⚠️ MQTT Disconnected:</strong> Attempting to reconnect...
          </div>
        )}

        {/* WiFi Status Display (Read-only) */}
        {mqtt.wifiSSID && (
          <div className="wifi-config-section">
            <h3>WiFi Status</h3>
            <div className="wifi-status-container">
              <div className="wifi-status-row">
                <div className="wifi-status-info">
                  <div>
                    <strong className="wifi-status-label">Current WiFi:</strong>
                    <span className={`wifi-status-value ${!mqtt.wifiConnected ? 'disconnected' : ''}`}>
                      {mqtt.wifiSSID}
                    </span>
                    {mqtt.wifiConnected && (
                      <span className="wifi-status-badge">✓ Connected</span>
                    )}
                    {!mqtt.wifiConnected && (
                      <span className="wifi-status-badge disconnected">⚠ Not connected</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {!mqtt.wifiConnected && (
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
                    {mqtt.data?.powerW !== undefined ? mqtt.data.powerW.toFixed(2) : "--"} W
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Energy</div>
                  <div className="value">
                    {mqtt.data?.energyKWh !== undefined ? mqtt.data.energyKWh.toFixed(3) : "--"} kWh
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Phones Charged</div>
                  <div className="value">
                    {mqtt.data?.phones !== undefined ? mqtt.data.phones.toFixed(2) : "--"}
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Battery</div>
                  <div className="value">
                    {mqtt.data?.batteryPct !== undefined ? Math.round(mqtt.data.batteryPct) : "--"}%
                  </div>
                </div>
              </div>
              <div className="kpis mt-10">
                <div className="kpi">
                  <div className="label">Battery V</div>
                  <div className="value">
                    {mqtt.data?.batteryV !== undefined ? mqtt.data.batteryV.toFixed(2) : "--"} V
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Efficiency</div>
                  <div className="value">
                    {mqtt.data?.efficiency !== undefined ? mqtt.data.efficiency.toFixed(1) : "--"}%
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">Panel Temp</div>
                  <div className="value">
                    {mqtt.data?.tempC !== undefined ? mqtt.data.tempC.toFixed(1) : "--"} °C
                  </div>
                </div>
                <div className="kpi">
                  <div className="label">State</div>
                  <div className="value">
                    {mqtt.data?.steady ? "Locked" : mqtt.data ? "Tracking" : "--"}
                  </div>
                </div>
              </div>
              <div className="flex-row mt-10">
                <span className="mono">
                  Tilt: {mqtt.data?.tiltAngle !== undefined ? mqtt.data.tiltAngle : "--"}°
                </span>
                <span className="mono">
                  Pan Cmd: {mqtt.data?.panCmd !== undefined ? mqtt.data.panCmd : "--"}
                </span>
                <span className="mono">
                  H.Err: {mqtt.data?.horizontalError !== undefined ? mqtt.data.horizontalError : "--"}
                </span>
                <span className="mono">
                  V.Err: {mqtt.data?.verticalError !== undefined ? mqtt.data.verticalError : "--"}
                </span>
              </div>
              <div className="chart">
                <canvas ref={charts.chartRef} width={720} height={210}></canvas>
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
                <span className="pill">{mqtt.manual ? "Manual Control" : "Auto Tracking"}</span>
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
                    value={mqtt.tiltValue}
                    step="1"
                    disabled={true}
                    style={{ opacity: 0.5 }}
                  />
                  <div className="slider-footer">
                    <span>
                      Value: <span className="mono">{mqtt.tiltValue}°</span>
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
                    value={mqtt.panValue}
                    step="1"
                    disabled={true}
                    style={{ opacity: 0.5 }}
                  />
                  <div className="slider-footer">
                    <span>
                      Value: <span className="mono">{mqtt.panValue}°</span>
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
                      // Clear any pending debounce timer (no auto-save on typing)
                      if (deviceNameDebounceRef.current) {
                        clearTimeout(deviceNameDebounceRef.current);
                        deviceNameDebounceRef.current = null;
                      }
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
                    setStartChargingLoading(true);
                    try {
                      // Save device name to database if it's been entered
                      if (deviceName && deviceName.trim().length > 0 && deviceName.trim().length <= 24) {
                        const trimmedName = deviceName.trim();
                        await saveDeviceName(trimmedName);
                        // Update currentDevice state immediately so it doesn't revert to "Unknown"
                        setCurrentDevice(trimmedName);
                        // Send device name and start charging command together in one message
                        await mqtt.sendControl({ deviceName: trimmedName, startCharging: true });
                      } else {
                        // Send start charging command only (no device name)
                        await mqtt.sendControl({ startCharging: true });
                      }
                      mqtt.setChargingStarted(true);
                      mqtt.setError("");
                    } catch (error) {
                      handleControlError(error, mqtt.setError, "start charging");
                    } finally {
                      setStartChargingLoading(false);
                    }
                  }}
                  disabled={!mqtt.mqttConnected || !mqtt.deviceId || startChargingLoading}
                >
                  {startChargingLoading 
                    ? "Starting..." 
                    : mqtt.chargingStarted 
                      ? "Charging Started ✓" 
                      : "Start Charging"}
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
                      value={gridPrice.gridPrice || ""}
                      onFocus={() => { 
                        gridPrice.gridPriceInputFocusedRef.current = true; 
                      }}
                      onBlur={() => {
                        gridPrice.gridPriceInputFocusedRef.current = false;
                      }}
                      onChange={(e) => {
                        // Prevent telemetry from interfering while user is typing
                        const newValue = e.target.value;
                        gridPrice.setGridPrice(newValue);
                        // Save to sessionStorage for refresh persistence
                        if (typeof window !== "undefined") {
                          sessionStorage.setItem("gridPriceInput", newValue);
                        }
                        // Mark that user is actively editing, so telemetry won't overwrite
                        if (newValue !== "") {
                          gridPrice.gridPriceLoadedFromDbRef.current = true;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          gridPrice.handleSaveGridPrice();
                        }
                      }}
                      placeholder="Enter price (e.g., 20.00)"
                      step="0.01"
                      min="0"
                      max="100000"
                      style={{ flex: "1", minWidth: "0" }}
                    />
                    <button
                      className="manual-btn"
                      onClick={gridPrice.handleSaveGridPrice}
                      disabled={!gridPrice.gridPrice || isNaN(parseFloat(gridPrice.gridPrice)) || parseFloat(gridPrice.gridPrice) <= 0 || parseFloat(gridPrice.gridPrice) >= 100000}
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
                    <td className="mono">{mqtt.data?.top !== undefined ? mqtt.data.top : "--"}</td>
                  </tr>
                  <tr>
                    <td>Left</td>
                    <td className="mono">{mqtt.data?.left !== undefined ? mqtt.data.left : "--"}</td>
                  </tr>
                  <tr>
                    <td>Right</td>
                    <td className="mono">{mqtt.data?.right !== undefined ? mqtt.data.right : "--"}</td>
                  </tr>
                  <tr>
                    <td>Average</td>
                    <td className="mono">{mqtt.data?.avg !== undefined ? mqtt.data.avg : "--"}</td>
                  </tr>
                </tbody>
              </table>
              <div className="muted mt-8">
                Actual Power Estimate: <span className="mono">{mqtt.data?.powerActualW !== undefined ? mqtt.data.powerActualW.toFixed(2) : "--"}</span> W
              </div>
              <div className="muted">
                Model Tilt: <span className="mono">{mqtt.data?.simTilt !== undefined ? mqtt.data.simTilt : "--"}</span>° | Model H.Err:{" "}
                <span className="mono">{mqtt.data?.simHErr !== undefined ? mqtt.data.simHErr : "--"}</span> | Model V.Err:{" "}
                <span className="mono">{mqtt.data?.simVErr !== undefined ? mqtt.data.simVErr : "--"}</span>
              </div>
            </div>
          </div>
          </div>

          <div className="card grid-full">
            <h3>Monthly Report — Energy History</h3>
            <div className="content">
              {(historyData.historyLoading || historyData.deviceStatsLoading) && (
                <div style={{ marginBottom: "16px", color: "var(--muted)", fontSize: "13px" }}>
                  {historyData.historyLoading && "Loading history data... "}
                  {historyData.deviceStatsLoading && "Loading device statistics... "}
                </div>
              )}
              {!historyData.historyLoading && historyData.historyError && (
                <div className="history-error">
                  <strong>History Error:</strong> {historyData.historyError}
                </div>
              )}
              {!historyData.deviceStatsLoading && historyData.deviceStatsError && (
                <div className="history-error" style={{ marginTop: historyData.historyError ? "8px" : "0" }}>
                  <strong>Device Stats Error:</strong> {historyData.deviceStatsError}
                </div>
              )}
              <div className="history-chart relative">
                <canvas ref={charts.historyChartRef} width={800} height={300}></canvas>
                {charts.tooltip && (
                  <div
                    className="tooltip"
                    style={{
                      left: typeof window !== "undefined" ? Math.min(charts.tooltip.x + 10, window.innerWidth - 220) : charts.tooltip.x + 10,
                      top: Math.max(charts.tooltip.y - 80, 10)
                    }}
                  >
                    <div className="tooltip-title">{charts.tooltip.date}</div>
                    <div className="tooltip-text">
                      {charts.tooltip.energy} kWh · {charts.tooltip.battery}% batt
                    </div>
                    <div className="tooltip-text" style={{ marginTop: "2px" }}>
                      {charts.tooltip.device}
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
                            deviceStatsData: historyData.deviceStatsData,
                            deviceStats: deviceStats,
                            registeredDevices: registeredDevices
                          });
                        }
                        
                        if (historyData.deviceStatsData && historyData.deviceStatsData.deviceStats && historyData.deviceStatsData.deviceStats.length > 0) {
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
                        {gridPrice.savedGridPrice !== null
                          ? `₱${((totalEnergyKWh * gridPrice.savedGridPrice) / 100).toFixed(2)}`
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
              <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                <button
                  className="manual-btn alt full-width"
                  onClick={() => {
                    // Prevent duplicate calls if already loading
                    if (!historyData.historyLoading && !historyData.deviceStatsLoading) {
                      historyData.loadHistory();
                      historyData.loadDeviceStats();
                    }
                  }}
                  disabled={historyData.historyLoading || historyData.deviceStatsLoading}
                >
                  {historyData.historyLoading || historyData.deviceStatsLoading ? "Refreshing..." : "Refresh History"}
                </button>
                <button
                  className="manual-btn full-width"
                  onClick={historyData.loadHistoryLogs}
                  disabled={historyData.historyLogsLoading}
                >
                  {historyData.historyLogsLoading ? "Loading..." : "View History Logs"}
                </button>
              </div>
            </div>
          </div>
        </div>
        <footer>Charge phones with sunshine — savings and impact shown are based on actual tracker readings and energy estimates.</footer>
      </div>

      {/* History Logs Modal */}
      {historyData.historyLogsOpen && (
        <div className="history-logs-modal-overlay" onClick={() => historyData.setHistoryLogsOpen(false)}>
          <div className="history-logs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="history-logs-modal-header">
              <h3>History Logs</h3>
              <button 
                className="history-logs-close-btn"
                onClick={() => historyData.setHistoryLogsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            {historyData.historyLogsLoading && (
              <div style={{ margin: "16px", textAlign: "center", color: "var(--muted)", fontSize: "14px" }}>
                Loading history logs...
              </div>
            )}
            {historyData.historyLogsError && (
              <div className="error-message" style={{ margin: "16px" }}>
                {historyData.historyLogsError}
              </div>
            )}
            
            {!historyData.historyLogsLoading && (
            <div className="history-logs-content" style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
              {/* Helper function to format time ago */}
              {(() => {
                const formatTimeAgo = (dateString) => {
                  if (!dateString) return "Never";
                  const date = new Date(dateString);
                  const now = new Date();
                  const diffMs = now - date;
                  const diffSeconds = Math.floor(diffMs / 1000);
                  const diffMinutes = Math.floor(diffSeconds / 60);
                  const diffHours = Math.floor(diffMinutes / 60);
                  const diffDays = Math.floor(diffHours / 24);
                  
                  if (diffSeconds < 60) return "Just now";
                  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
                  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
                  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
                  
                  const diffMonths = Math.floor(diffDays / 30);
                  if (diffMonths < 12) return `${diffMonths} month${diffMonths !== 1 ? "s" : ""} ago`;
                  
                  const diffYears = Math.floor(diffDays / 365);
                  return `${diffYears} year${diffYears !== 1 ? "s" : ""} ago`;
                };

                // Get last updated time for each registered device from device_registration
                const deviceLastTimes = registeredDevices.map(deviceName => {
                  // Find device in history logs devices array (from device_registration table)
                  const device = historyData.historyLogsData.devices?.find(
                    d => d.device_name === deviceName
                  );
                  
                  return {
                    name: deviceName,
                    lastTime: device?.updated_at || null
                  };
                });

                // Sort by most recent first
                deviceLastTimes.sort((a, b) => {
                  if (!a.lastTime && !b.lastTime) return 0;
                  if (!a.lastTime) return 1;
                  if (!b.lastTime) return -1;
                  return new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime();
                });

                // Limit to 10 most recent devices
                const MAX_DEVICES = 10;
                const displayDevices = deviceLastTimes.slice(0, MAX_DEVICES);
                const hasMoreDevices = deviceLastTimes.length > MAX_DEVICES;
                const remainingCount = deviceLastTimes.length - MAX_DEVICES;

                return (
                  <>
                    {/* Left Column: Grid Price & Estimated Savings (wider) */}
                    <div style={{ flex: "2", minWidth: "0" }}>
                      <div className="history-logs-section">
                        <div className="history-logs-section-header">
                          <h4>Grid Price & Estimated Savings</h4>
                          <span className="history-logs-section-count">
                            {historyData.historyLogsData.grid_prices.length} price entries
                          </span>
                        </div>
                        {gridPrice.savedGridPrice !== null && (
                          <div className="history-logs-current-savings">
                            <div className="history-logs-current-savings-label">Current Grid Price:</div>
                            <div className="history-logs-current-savings-value">
                              {gridPrice.savedGridPrice.toFixed(2)} cents/kWh
                            </div>
                            <div className="history-logs-current-savings-label" style={{ marginTop: "8px" }}>
                              Total Estimated Savings:
                            </div>
                            <div className="history-logs-current-savings-value">
                              ₱{((totalEnergyKWh * gridPrice.savedGridPrice) / 100).toFixed(2)}
                            </div>
                          </div>
                        )}
                        <div className="history-logs-table-container">
                          <table className="history-logs-table">
                            <thead>
                              <tr>
                                <th>ID</th>
                                <th>Price (cents/kWh)</th>
                                <th>Estimated Savings (₱)</th>
                                <th>Created At</th>
                              </tr>
                            </thead>
                            <tbody>
                              {historyData.historyLogsData.grid_prices.length > 0 ? (
                                historyData.historyLogsData.grid_prices.map((price) => (
                                  <tr key={price.id}>
                                    <td>{price.id}</td>
                                    <td>{Number(price.price).toFixed(2)}</td>
                                    <td>{price.estimated_savings !== null && price.estimated_savings !== undefined ? `₱${Number(price.estimated_savings).toFixed(2)}` : "—"}</td>
                                    <td className="mono">
                                      {price.created_at 
                                        ? new Date(price.created_at).toLocaleString("en-US", { 
                                            year: "numeric", 
                                            month: "short", 
                                            day: "numeric", 
                                            hour: "2-digit", 
                                            minute: "2-digit",
                                            second: "2-digit"
                                          })
                                        : "—"}
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan="4" style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                                    No grid price history available
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Recent Devices List (narrower) */}
                    <div style={{ flex: "1", minWidth: "0" }}>
                      <div className="history-logs-section">
                        <div className="history-logs-section-header">
                          <h4>Recent Devices</h4>
                          <span className="history-logs-section-count">
                            {registeredDevices.length} registered device{registeredDevices.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="history-logs-table-container">
                          {displayDevices.length > 0 ? (
                            <>
                              <div style={{ padding: "12px 0" }}>
                                {displayDevices.map((device, idx) => (
                                  <div 
                                    key={idx} 
                                    style={{ 
                                      display: "flex", 
                                      justifyContent: "space-between", 
                                      alignItems: "center",
                                      padding: "8px 12px",
                                      borderBottom: idx < displayDevices.length - 1 ? "1px solid var(--grid)" : "none"
                                    }}
                                  >
                                    <span style={{ fontWeight: "500" }}>{device.name}</span>
                                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>
                                      {device.lastTime ? formatTimeAgo(device.lastTime) : "Never"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {hasMoreDevices && (
                                <div style={{ 
                                  textAlign: "center", 
                                  color: "var(--muted)", 
                                  fontSize: "12px",
                                  padding: "12px",
                                  borderTop: "1px solid var(--grid)",
                                  fontStyle: "italic"
                                }}>
                                  Showing {MAX_DEVICES} of {registeredDevices.length} devices. {remainingCount} more not shown.
                                </div>
                              )}
                            </>
                          ) : (
                            <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                              No registered devices
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}