import { useState, useRef, useMemo, useCallback } from "react";

const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

// Storage keys
const LS_SOLAR_NAME_KEY = "solarName";
const SS_SOLAR_NAME_INPUT_KEY = "solarNameInput";

/**
 * Solar Unit management (single "device")
 * - solarName is the user-defined name for the solar prototype
 * - registeredDevices is kept as an array for backward compatibility (0 or 1 item)
 */
export function useDeviceManagement(data, sendControl) {
  // Initialize from storage (prefer session for refresh continuity, then localStorage)
  const initialSolarName =
    typeof window !== "undefined"
      ? (sessionStorage.getItem(SS_SOLAR_NAME_INPUT_KEY) ||
          localStorage.getItem(LS_SOLAR_NAME_KEY) ||
          "")
      : "";

  const [solarName, setSolarName] = useState(initialSolarName);
  const [currentSolarName, setCurrentSolarName] = useState(initialSolarName || "Unknown");

  // Back-compat shape: other hooks expect an array
  const registeredDevices = useMemo(() => {
    const name = (solarName || "").trim();
    return name ? [name] : [];
  }, [solarName]);

  const solarNameRegistered = registeredDevices.length > 0;

  const solarNameInputFocusedRef = useRef(false);
  const solarNameDebounceRef = useRef(null);
  const solarNameLoadedFromDbRef = useRef(false);

  // Back-compat wrappers (dashboard currently destructures these names)
  const deviceName = solarName;
  const setDeviceName = (v) => setSolarName(v);
  const currentDevice = currentSolarName;
  const setCurrentDevice = (v) => setCurrentSolarName(v);

  const persistSolarNameToStorage = useCallback((name) => {
    if (typeof window === "undefined") return;
    const trimmed = (name || "").trim();
    sessionStorage.setItem(SS_SOLAR_NAME_INPUT_KEY, trimmed);
    if (trimmed) localStorage.setItem(LS_SOLAR_NAME_KEY, trimmed);
  }, []);

  const clearSolarNameFromStorage = useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(SS_SOLAR_NAME_INPUT_KEY);
    localStorage.removeItem(LS_SOLAR_NAME_KEY);
  }, []);

  // Load Solar Name from backend (optional)
  const loadDeviceName = async () => {
    if (!RAILWAY_API_BASE_URL) return;

    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;

      const res = await fetch(`${base}/api/device`);
      if (!res.ok) return;

      const json = await res.json();
      const name = (json.device_name || "").trim();
      if (name && !solarNameInputFocusedRef.current) {
        setSolarName(name);
        setCurrentSolarName(name);
        persistSolarNameToStorage(name);
        solarNameLoadedFromDbRef.current = true;
      }
    } catch (e) {
      console.error("Failed to load solar name:", e);
    }
  };

  // Load registered "devices" list but treat it as single Solar Unit
  const loadRegisteredDevices = async () => {
    if (!RAILWAY_API_BASE_URL) return;

    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;

      const fetchUrl = `${base}/api/devices`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(fetchUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return;

      const json = await res.json();
      if (!json.devices || !Array.isArray(json.devices)) return;

      const names = json.devices
        .map((d) => (typeof d === "string" ? d : d.device_name || d))
        .map((n) => (n || "").trim())
        .filter(Boolean);

      // Treat as single Solar Unit: prefer stored solarName, else first backend entry
      const stored =
        typeof window !== "undefined" ? (localStorage.getItem(LS_SOLAR_NAME_KEY) || "").trim() : "";

      const chosen = (stored || names[0] || "").trim();
      if (chosen && !solarNameInputFocusedRef.current) {
        setSolarName(chosen);
        setCurrentSolarName(chosen);
        persistSolarNameToStorage(chosen);
      }
    } catch (e) {
      if (e.name === "AbortError" || e.name === "TimeoutError") {
        console.warn("[Solar Unit] loadRegisteredDevices timeout");
      } else if (e.message?.includes("ERR_INSUFFICIENT_RESOURCES")) {
        console.warn("[Solar Unit] resource limit, retry later");
      } else {
        console.error("Failed to load solar registration:", e);
      }
    }
  };

  // Save Solar Name to backend + persist locally
  const saveDeviceName = async (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return;

    // Persist immediately (requirement: enable telemetry view immediately)
    setSolarName(trimmed);
    setCurrentSolarName(trimmed);
    persistSolarNameToStorage(trimmed);

    if (!RAILWAY_API_BASE_URL) return;

    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;

      const res = await fetch(`${base}/api/device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Backward compatible backend field name
        body: JSON.stringify({ device_name: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`Failed to save solar name: ${res.status} ${res.statusText}`);
      }

      solarNameLoadedFromDbRef.current = true;
      await loadRegisteredDevices();
    } catch (e) {
      console.error("Failed to save solar name:", e);
      // Don't block UI — MQTT side is more important
    }
  };

  return {
    // Backward-compatible names (dashboard currently expects these)
    deviceName,
    setDeviceName,
    currentDevice,
    setCurrentDevice,
    registeredDevices,

    // New solar-specific signals
    solarName,
    setSolarName,
    currentSolarName,
    setCurrentSolarName,
    solarNameRegistered,

    // Existing refs (renamed but keep exports for dashboard)
    deviceNameInputFocusedRef: solarNameInputFocusedRef,
    deviceNameDebounceRef: solarNameDebounceRef,
    deviceNameLoadedFromDbRef: solarNameLoadedFromDbRef,

    // Load/save functions (kept names for minimal changes)
    loadDeviceName,
    loadRegisteredDevices,
    saveDeviceName,

    // Optional helper (not required, but handy)
    clearSolarNameFromStorage,
  };
}