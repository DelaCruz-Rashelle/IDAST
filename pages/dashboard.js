import { useEffect, useState, useRef } from "react";
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

// Storage keys for Solar Name
const LS_SOLAR_NAME_KEY = "solarName";
const SS_SOLAR_NAME_INPUT_KEY = "solarNameInput";

export default function Home() {
  const router = useRouter();
  const [registerLoading, setRegisterLoading] = useState(false);

  // Saved Solar Name: only set on load (from storage) or when user clicks Register. Used for gate + name matching.
  const [savedSolarName, setSavedSolarName] = useState("");
  // Gate: open only when a name has been registered (clicked), not while typing
  const [solarNameGate, setSolarNameGate] = useState(false);
  // Ref for MQTT hook: only accept telemetry when incoming name matches this (saved name only)
  const expectedSolarNameRef = useRef("");

  // Get the first day of the previous month (January)
  const today = new Date();
  const REPORT_END = new Date(today.getFullYear(), today.getMonth(), 1); // First day of current month
  const REPORT_START = new Date(today.getFullYear(), today.getMonth() - 1, 1); // First day of previous month

  /**
   * 1) MQTT hook — GATED
   * Only connect/subscribe/process telemetry when a Solar Name is registered.
   * Telemetry is accepted only when the unit's name (from firmware) matches the registered name.
   */
  const mqtt = useMqttConnection(null, null, solarNameGate, expectedSolarNameRef);

  /**
   * 2) Device/Solar Unit management hook
   * This hook should now treat the Solar as the only device.
   */
  const {
    deviceName,
    setDeviceName,
    currentDevice,
    setCurrentDevice,
    deviceNameInputFocusedRef,
    deviceNameDebounceRef,
    loadRegisteredDevices,
    saveDeviceName,
  } = useDeviceManagement(mqtt.data, mqtt.sendControl);

  /**
   * 3) Grid price hook
   */
  const gridPrice = useGridPrice(mqtt.sendControl, mqtt.setError);

  /**
   * 4) History data hook
   */
  const historyData = useHistoryData();

  // Only the saved (committed) name is used for data — not the live input
  const registeredSolarForData = (savedSolarName || "").trim() ? [(savedSolarName || "").trim()] : [];

  /**
   * 5) Charts hook
   */
  const charts = useCharts(mqtt.sensorHistory, mqtt.data);

  /**
   * 6) Energy calculations hook
   */
  const { totalEnergyKWh, avgPerDay, deviceStats } = useEnergyCalculations(
    historyData.historyData,
    historyData.deviceStatsData,
    registeredSolarForData
  );

  /**
   * Wire MQTT callbacks after hooks are initialized
   */
  useEffect(() => {
    if (mqtt.setSetCurrentDevice) {
      mqtt.setSetCurrentDevice(setCurrentDevice);
    }
    if (mqtt.setOnTelemetryProcessed) {
      mqtt.setOnTelemetryProcessed(() => {
        if (charts.drawSensorGraph) charts.drawSensorGraph();
      });
    }
  }, [setCurrentDevice, mqtt.setSetCurrentDevice, mqtt.setOnTelemetryProcessed, charts.drawSensorGraph]);

  /**
   * Auth check + load Solar Name gate from storage on mount
   * IMPORTANT: we do NOT wipe Solar Name anymore (must persist).
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isAuthenticated = sessionStorage.getItem("isAuthenticated");
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    // Restore saved Solar Name from storage (only this counts as "registered" for gate + matching)
    const storedSolar =
      (sessionStorage.getItem(SS_SOLAR_NAME_INPUT_KEY) || localStorage.getItem(LS_SOLAR_NAME_KEY) || "").trim();

    setSavedSolarName(storedSolar);
    setSolarNameGate(!!storedSolar);

    // Do NOT clear deviceName input anymore (requirement: persist solar registration)
    // We only clear grid price transient input (optional behavior kept similar)
    sessionStorage.removeItem("gridPriceInput");
    sessionStorage.removeItem("isPageRefresh");
  }, [router]);

  /**
   * Use only the saved (committed) Solar Name for matching — not the live input.
   * So typing in the field does not trigger "Device not recognized" or change the gate.
   */
  useEffect(() => {
    expectedSolarNameRef.current = (savedSolarName || "").trim();
  }, [savedSolarName]);

  /**
   * Handle tab/browser close: clear only transient inputs (not solar registration)
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeUnload = () => {
      sessionStorage.removeItem("isPageRefresh");
      sessionStorage.removeItem("gridPriceInput");
      // DO NOT clear solar name
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, []);

  /**
   * Load data on mount (no polling)
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!sessionStorage.getItem("isAuthenticated")) return;

    historyData.loadHistory();

    const deviceStatsTimeout = setTimeout(() => {
      historyData.loadDeviceStats();
    }, 500);

    const devicesTimeout = setTimeout(() => {
      loadRegisteredDevices();
    }, 1000);

    return () => {
      if (deviceNameDebounceRef.current) clearTimeout(deviceNameDebounceRef.current);
      clearTimeout(deviceStatsTimeout);
      clearTimeout(devicesTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived UI states — "registered" only when user has clicked Register (saved name), not while typing
  const isSolarRegistered = !!(savedSolarName || "").trim();
  const telemetryOnline = isSolarRegistered && !!mqtt.data;
  const mqttAllowed = isSolarRegistered; // by requirement
  const mqttStatusLabel = !mqttAllowed ? "MQTT Disabled" : mqtt.mqttConnected ? "MQTT Connected" : "MQTT Disconnected";

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

            <span className="pill">{isSolarRegistered ? "Solar Registered" : "Solar Not Registered"}</span>
            <span className="pill">{mqttStatusLabel}</span>
            <span className="pill">{telemetryOnline ? "Online" : "Offline"}</span>
          </div>

          <div className="header-right">
            <button
              className="logout-btn"
              onClick={() => {
                if (typeof window !== "undefined") {
                  sessionStorage.removeItem("isAuthenticated");
                  sessionStorage.removeItem("email");
                  sessionStorage.removeItem("isPageRefresh");
                  sessionStorage.removeItem("gridPriceInput");
                  // DO NOT clear solar registration on logout unless you explicitly want that
                  router.push("/login");
                }
              }}
              title="Logout"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Solar registration gate message */}
        {!isSolarRegistered && (
          <div className="warning-message">
            <strong>☀️ Solar not registered yet:</strong> Please set a <b>Solar Name</b> first to enable live telemetry.
          </div>
        )}

        {mqtt.error && (
          <div className="error-message">
            <strong>{mqtt.error.startsWith("Device not recognized") ? "Device not recognized" : "Connection Error"}:</strong> {mqtt.error.startsWith("Device not recognized") ? mqtt.error.replace(/^Device not recognized\.?\s*/i, "") : mqtt.error}
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

        {mqttAllowed && !mqtt.mqttConnected && MQTT_BROKER_URL && (
          <div className="warning-message">
            <strong>⚠️ MQTT Disconnected:</strong> Attempting to reconnect...
          </div>
        )}

        {/* WiFi Status Display (Read-only) — only meaningful when solar registered */}
        {isSolarRegistered && mqtt.wifiSSID && (
          <div className="wifi-config-section">
            <h3>WiFi Status</h3>
            <div className="wifi-status-container">
              <div className="wifi-status-row">
                <div className="wifi-status-info">
                  <div>
                    <strong className="wifi-status-label">Current WiFi:</strong>
                    <span className={`wifi-status-value ${!mqtt.wifiConnected ? "disconnected" : ""}`}>{mqtt.wifiSSID}</span>
                    {mqtt.wifiConnected && <span className="wifi-status-badge">✓ Connected</span>}
                    {!mqtt.wifiConnected && <span className="wifi-status-badge disconnected">⚠ Not connected</span>}
                  </div>
                </div>
              </div>
            </div>

            {!mqtt.wifiConnected && (
              <div className="wifi-note" style={{ marginTop: "15px" }}>
                <strong>Note:</strong> ESP32 is not connected to WiFi. To configure WiFi, connect to the ESP32's AP network
                (<code>Solar_Capstone_Admin</code>, password: <code>12345678</code>) and visit{" "}
                <code>http://192.168.4.1/wifi-setup</code>
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
            <div className="sub">Cumulative energy harvested by the Solar Unit</div>
            <div className="trend">Goal: 0.150 kWh by end of month</div>
          </div>
        </div>

        <div className="grid">
          {/* LEFT: Realtime telemetry */}
          <div className="card">
            <h3>Realtime Solar Telemetry</h3>
            <div className="content">
              {!isSolarRegistered ? (
                <div className="muted" style={{ padding: "14px", fontSize: "14px" }}>
                  <b>Solar not registered yet.</b> Register a <b>Solar Name</b> to unlock live telemetry and charts.
                </div>
              ) : (
                <>
                  <div className="kpis">
                    <div className="kpi">
                      <div className="label">Panel Power</div>
                      <div className="value">{mqtt.data?.powerW !== undefined ? mqtt.data.powerW.toFixed(2) : "--"} W</div>
                    </div>
                    <div className="kpi">
                      <div className="label">Energy</div>
                      <div className="value">{mqtt.data?.energyKWh !== undefined ? mqtt.data.energyKWh.toFixed(3) : "--"} kWh</div>
                    </div>
                    <div className="kpi">
                      <div className="label">Charging Sessions</div>
                      <div className="value">{mqtt.data?.phones !== undefined ? mqtt.data.phones.toFixed(2) : "--"}</div>
                    </div>
                    <div className="kpi">
                      <div className="label">Battery</div>
                      <div className="value">{mqtt.data?.batteryPct !== undefined ? Math.round(mqtt.data.batteryPct) : "--"}%</div>
                    </div>
                  </div>

                  <div className="kpis mt-10">
                    <div className="kpi">
                      <div className="label">Battery V</div>
                      <div className="value">{mqtt.data?.batteryV !== undefined ? mqtt.data.batteryV.toFixed(2) : "--"} V</div>
                    </div>
                    <div className="kpi">
                      <div className="label">Efficiency</div>
                      <div className="value">{mqtt.data?.efficiency !== undefined ? mqtt.data.efficiency.toFixed(1) : "--"}%</div>
                    </div>
                    <div className="kpi">
                      <div className="label">Panel Temp</div>
                      <div className="value">{mqtt.data?.tempC !== undefined ? mqtt.data.tempC.toFixed(1) : "--"} °C</div>
                    </div>
                    <div className="kpi">
                      <div className="label">State</div>
                      <div className="value">{mqtt.data?.steady ? "Locked" : mqtt.data ? "Tracking" : "--"}</div>
                    </div>
                  </div>

                  <div className="flex-row mt-10">
                    <span className="mono">Tilt: {mqtt.data?.tiltAngle !== undefined ? mqtt.data.tiltAngle : "--"}°</span>
                    <span className="mono">Pan Angle: {mqtt.data?.panAngle !== undefined ? mqtt.data.panAngle : "--"}</span>
                    <span className="mono">H.Err: {mqtt.data?.horizontalError !== undefined ? mqtt.data.horizontalError : "--"}</span>
                    <span className="mono">V.Err: {mqtt.data?.verticalError !== undefined ? mqtt.data.verticalError : "--"}</span>
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
                      Servo control disabled (read-only mode). Grid price and Solar Name can be edited below.
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
                </>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="right-column-container">
            {/* Solar Unit Registration */}
            <div className="card card-auto-fit">
              <h3>Solar Unit Registration & Settings</h3>
              <div className="content" style={{ padding: "12px 14px 16px 14px" }}>
                <div className="form-group">
                  <label htmlFor="solarName">Solar Name</label>
                  <input
                    type="text"
                    id="solarName"
                    value={deviceName}
                    onFocus={() => {
                      deviceNameInputFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      deviceNameInputFocusedRef.current = false;
                    }}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setDeviceName(newName);

                      // Persist input as user types (session), and allow local persist when saved
                      if (typeof window !== "undefined") {
                        sessionStorage.setItem(SS_SOLAR_NAME_INPUT_KEY, newName);
                      }

                      if (deviceNameDebounceRef.current) {
                        clearTimeout(deviceNameDebounceRef.current);
                        deviceNameDebounceRef.current = null;
                      }
                    }}
                    placeholder="Enter Solar Name (e.g., Solar Unit A)"
                    maxLength={24}
                  />
                </div>

                <div className="mb-12" style={{ fontSize: "13px" }}>
                  Current Solar Unit: <span className="mono fw-600">{currentDevice}</span>
                </div>

                <button
                  className="manual-btn full-width mt-8"
                  onClick={async () => {
                    setRegisterLoading(true);
                    try {
                      if (!deviceName || deviceName.trim().length === 0) {
                        throw new Error("Please enter a Solar Name first.");
                      }
                      if (deviceName.trim().length > 24) {
                        throw new Error("Solar Name too long (max 24 characters).");
                      }

                      const trimmedName = deviceName.trim();

                      // Save Solar Name (backend + local) and open gate so telemetry can connect
                      await saveDeviceName(trimmedName);

                      if (typeof window !== "undefined") {
                        localStorage.setItem(LS_SOLAR_NAME_KEY, trimmedName);
                        sessionStorage.setItem(SS_SOLAR_NAME_INPUT_KEY, trimmedName);
                      }
                      setSavedSolarName(trimmedName);
                      setSolarNameGate(true);
                      setCurrentDevice(trimmedName);

                      // Best-effort: send name + start command to unit (fails if MQTT not connected yet)
                      try {
                        await mqtt.sendControl({ deviceName: trimmedName, startCharging: true });
                        mqtt.setError("");
                      } catch (controlErr) {
                        mqtt.setError("Solar Name saved. Could not send command to unit — connect the unit to WiFi/MQTT and ensure the name matches (e.g. Solar Unit A).");
                        return;
                      }

                      mqtt.setChargingStarted(true);
                    } catch (error) {
                      handleControlError(error, mqtt.setError, "register");
                    } finally {
                      setRegisterLoading(false);
                    }
                  }}
                  disabled={!(deviceName || "").trim() || registerLoading}
                >
                  {registerLoading
                    ? "Registering..."
                    : mqtt.error?.startsWith("Device not recognized")
                      ? "Unit not found — enter matching name and Register"
                      : mqtt.chargingStarted
                        ? "Registered ✓"
                        : "Register"}
                </button>

                {!isSolarRegistered && (
                  <div className="muted" style={{ marginTop: "10px", fontSize: "12px" }}>
                    Tip: Save a Solar Name first — once registered, telemetry will connect automatically.
                  </div>
                )}
              </div>
            </div>

            {/* Grid Price */}
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
                        const newValue = e.target.value;
                        gridPrice.setGridPrice(newValue);
                        if (typeof window !== "undefined") {
                          sessionStorage.setItem("gridPriceInput", newValue);
                        }
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
                      disabled={
                        !gridPrice.gridPrice ||
                        isNaN(parseFloat(gridPrice.gridPrice)) ||
                        parseFloat(gridPrice.gridPrice) <= 0 ||
                        parseFloat(gridPrice.gridPrice) >= 100000
                      }
                      style={{ whiteSpace: "nowrap" }}
                    >
                      Estimate Savings
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sensors */}
            <div className="card">
              <h3>Actual Sensors & Servo</h3>
              <div className="content">
                {!isSolarRegistered ? (
                  <div className="muted" style={{ padding: "10px 0" }}>
                    Solar not registered yet — sensor readouts will appear after registration.
                  </div>
                ) : (
                  <>
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
                      Actual Power Estimate:{" "}
                      <span className="mono">{mqtt.data?.powerActualW !== undefined ? mqtt.data.powerActualW.toFixed(2) : "--"}</span> W
                    </div>
                    <div className="muted">
                      Model Tilt: <span className="mono">{mqtt.data?.simTilt !== undefined ? mqtt.data.simTilt : "--"}</span>° | Model H.Err:{" "}
                      <span className="mono">{mqtt.data?.simHErr !== undefined ? mqtt.data.simHErr : "--"}</span> | Model V.Err:{" "}
                      <span className="mono">{mqtt.data?.simVErr !== undefined ? mqtt.data.simVErr : "--"}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Solar metrics & Estimated Savings (no monthly report graph) */}
          <div className="card grid-full">
            <h3>Solar metrics & Estimated Savings</h3>

            <div className="content">
              {(historyData.historyLoading || historyData.deviceStatsLoading) && (
                <div style={{ marginBottom: "16px", color: "var(--muted)", fontSize: "13px" }}>
                  {historyData.historyLoading && "Loading history data... "}
                  {historyData.deviceStatsLoading && "Loading Solar Unit statistics... "}
                </div>
              )}

              {!historyData.historyLoading && historyData.historyError && (
                <div className="history-error">
                  <strong>History Error:</strong> {historyData.historyError}
                </div>
              )}

              {!historyData.deviceStatsLoading && historyData.deviceStatsError && (
                <div className="history-error" style={{ marginTop: historyData.historyError ? "8px" : "0" }}>
                  <strong>Solar Unit Stats Error:</strong> {historyData.deviceStatsError}
                </div>
              )}

              <div className="history-meta">
                <h4>Solar Unit highlights (rolling 60 days)</h4>

                <ul id="historyHighlights">
                  {deviceStats.length > 0 ? (
                    deviceStats.map((stat, idx) => {
                      const firstDate =
                        stat.firstSeen > 0
                          ? new Date(stat.firstSeen > 1e12 ? stat.firstSeen : stat.firstSeen * 1000).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—";

                      const lastDate =
                        stat.lastSeen > 0
                          ? new Date(stat.lastSeen > 1e12 ? stat.lastSeen : stat.lastSeen * 1000).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—";

                      return (
                        <li key={idx} style={{ marginBottom: "8px" }}>
                          <strong>{stat.name}</strong> — {stat.totalEnergyKWh.toFixed(3)} kWh total
                          {stat.sessionCount > 0 && (
                            <span className="muted" style={{ fontSize: "12px", display: "block", marginTop: "2px" }}>
                              {stat.sessionCount} session{stat.sessionCount !== 1 ? "s" : ""} ·{" "}
                              {stat.avgBattery > 0 && ` Avg battery: ${stat.avgBattery.toFixed(1)}% ·`} First seen: {firstDate} · Last seen: {lastDate}
                            </span>
                          )}
                        </li>
                      );
                    })
                  ) : (
                    <li className="muted" style={{ fontStyle: "italic" }}>
                      {!isSolarRegistered
                        ? "Solar not registered yet. Register a Solar Name to track Solar Unit highlights."
                        : "No Solar Unit highlights available yet. Start charging to record energy history."}
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
                      <td>{avgPerDay > 0 ? avgPerDay.toFixed(3) : "0.000"} kWh</td>
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
                      <td>Most Active Solar Unit</td>
                      <td>{deviceStats.length > 0 ? deviceStats[0].name : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                <button
                  className="manual-btn alt full-width"
                  onClick={() => {
                    if (!historyData.historyLoading && !historyData.deviceStatsLoading) {
                      historyData.loadHistory();
                      historyData.loadDeviceStats();
                    }
                  }}
                  disabled={historyData.historyLoading || historyData.deviceStatsLoading}
                >
                  {historyData.historyLoading || historyData.deviceStatsLoading ? "Refreshing..." : "Refresh History"}
                </button>

                <button className="manual-btn full-width" onClick={historyData.loadHistoryLogs} disabled={historyData.historyLogsLoading}>
                  {historyData.historyLogsLoading ? "Loading..." : "View History Logs"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer>Solar telemetry is enabled only after Solar Unit registration.</footer>
      </div>

      {/* History Logs Modal */}
      {historyData.historyLogsOpen && (
        <div className="history-logs-modal-overlay" onClick={() => historyData.setHistoryLogsOpen(false)}>
          <div className="history-logs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="history-logs-modal-header">
              <h3>History Logs</h3>
              <button className="history-logs-close-btn" onClick={() => historyData.setHistoryLogsOpen(false)} aria-label="Close">
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

                  // Single Solar Unit (still array for compatibility)
                  const solarLastTimes = registeredSolarForData.map((solarName) => {
                    const device = historyData.historyLogsData.devices?.find((d) => d.device_name === solarName);
                    return {
                      name: solarName,
                      lastTime: device?.updated_at || null,
                    };
                  });

                  solarLastTimes.sort((a, b) => {
                    if (!a.lastTime && !b.lastTime) return 0;
                    if (!a.lastTime) return 1;
                    if (!b.lastTime) return -1;
                    return new Date(b.lastTime).getTime() - new Date(a.lastTime).getTime();
                  });

                  const MAX_DEVICES = 10;
                  const displaySolars = solarLastTimes.slice(0, MAX_DEVICES);
                  const hasMore = solarLastTimes.length > MAX_DEVICES;
                  const remainingCount = solarLastTimes.length - MAX_DEVICES;

                  return (
                    <>
                      {/* Left Column */}
                      <div style={{ flex: "2", minWidth: "0" }}>
                        <div className="history-logs-section">
                          <div className="history-logs-section-header">
                            <h4>Grid Price & Estimated Savings</h4>
                            <span className="history-logs-section-count">{historyData.historyLogsData.grid_prices.length} price entries</span>
                          </div>

                          {gridPrice.savedGridPrice !== null && (
                            <div className="history-logs-current-savings">
                              <div className="history-logs-current-savings-label">Current Grid Price:</div>
                              <div className="history-logs-current-savings-value">{gridPrice.savedGridPrice.toFixed(2)} cents/kWh</div>

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
                                      <td>
                                        {price.estimated_savings !== null && price.estimated_savings !== undefined
                                          ? `₱${Number(price.estimated_savings).toFixed(2)}`
                                          : "—"}
                                      </td>
                                      <td className="mono">
                                        {price.created_at
                                          ? new Date(price.created_at).toLocaleString("en-US", {
                                              year: "numeric",
                                              month: "short",
                                              day: "numeric",
                                              hour: "2-digit",
                                              minute: "2-digit",
                                              second: "2-digit",
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

                      {/* Right Column */}
                      <div style={{ flex: "1", minWidth: "0" }}>
                        <div className="history-logs-section">
                          <div className="history-logs-section-header">
                            <h4>Recent Solar Units</h4>
                            <span className="history-logs-section-count">
                              {registeredSolarForData.length} registered Solar Unit{registeredSolarForData.length !== 1 ? "s" : ""}
                            </span>
                          </div>

                          <div className="history-logs-table-container">
                            {displaySolars.length > 0 ? (
                              <>
                                <div style={{ padding: "12px 0" }}>
                                  {displaySolars.map((solar, idx) => (
                                    <div
                                      key={idx}
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        padding: "8px 12px",
                                        borderBottom: idx < displaySolars.length - 1 ? "1px solid var(--grid)" : "none",
                                      }}
                                    >
                                      <span style={{ fontWeight: "500" }}>{solar.name}</span>
                                      <span style={{ color: "var(--muted)", fontSize: "13px" }}>
                                        {solar.lastTime ? formatTimeAgo(solar.lastTime) : "Never"}
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {hasMore && (
                                  <div
                                    style={{
                                      textAlign: "center",
                                      color: "var(--muted)",
                                      fontSize: "12px",
                                      padding: "12px",
                                      borderTop: "1px solid var(--grid)",
                                      fontStyle: "italic",
                                    }}
                                  >
                                    Showing {MAX_DEVICES} of {registeredSolarForData.length} Solar Units. {remainingCount} more not shown.
                                  </div>
                                )}
                              </>
                            ) : (
                              <div style={{ textAlign: "center", color: "var(--muted)", padding: "20px" }}>
                                No registered Solar Unit
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