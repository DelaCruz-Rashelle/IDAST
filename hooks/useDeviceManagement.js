import { useState, useRef } from "react";

const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

/**
 * Custom hook for device name, registered devices, and device state management
 * @param {Object} data - Telemetry data from MQTT (for saveDeviceState)
 * @param {Function} sendControl - MQTT control command function
 * @returns {Object} Device management state and functions
 */
export function useDeviceManagement(data, sendControl) {
  const [deviceName, setDeviceName] = useState("");
  const [currentDevice, setCurrentDevice] = useState("Unknown");
  const [registeredDevices, setRegisteredDevices] = useState([]);
  const [saveStateStatus, setSaveStateStatus] = useState({ loading: false, success: false, error: null });
  
  const deviceNameInputFocusedRef = useRef(false);
  const deviceNameDebounceRef = useRef(null);
  const deviceNameLoadedFromDbRef = useRef(false);

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

  return {
    deviceName,
    setDeviceName,
    currentDevice,
    setCurrentDevice,
    registeredDevices,
    saveStateStatus,
    deviceNameInputFocusedRef,
    deviceNameDebounceRef,
    deviceNameLoadedFromDbRef,
    loadDeviceName,
    loadRegisteredDevices,
    saveDeviceName,
    saveDeviceState
  };
}

