import { useState, useRef } from "react";

const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

/**
 * Custom hook for device name and registered devices management
 * @param {Object} data - Telemetry data from MQTT
 * @param {Function} sendControl - MQTT control command function
 * @returns {Object} Device management state and functions
 */
export function useDeviceManagement(data, sendControl) {
  const [deviceName, setDeviceName] = useState("");
  const [currentDevice, setCurrentDevice] = useState("Unknown");
  const [registeredDevices, setRegisteredDevices] = useState([]);
  
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
      const fetchUrl = `${base}/api/devices`;
      console.log("[Registered Devices] Fetching from:", fetchUrl);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const res = await fetch(fetchUrl, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
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
      // Handle timeout and resource limit errors gracefully
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        console.warn("[Registered Devices] Request timeout, will retry on next interval");
      } else if (e.message?.includes('ERR_INSUFFICIENT_RESOURCES')) {
        console.warn("[Registered Devices] Browser resource limit reached, will retry on next interval");
      } else {
        console.error("Failed to load registered devices:", e);
      }
      // Don't show error to user for this - it's okay if it fails, will retry on interval
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

  return {
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
  };
}

