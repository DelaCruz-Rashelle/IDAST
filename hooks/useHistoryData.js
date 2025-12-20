import { useState, useRef, useEffect, useCallback } from "react";
import { handleApiError } from "../utils/errorHandler.js";

const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

/**
 * Custom hook for history data loading, logs, and device statistics
 * @param {Function} onHistoryLoaded - Callback when history CSV is loaded (for chart drawing)
 * @returns {Object} History data state and functions
 */
export function useHistoryData(onHistoryLoaded) {
  const onHistoryLoadedRef = useRef(onHistoryLoaded);
  
  // Update ref when callback changes
  useEffect(() => {
    onHistoryLoadedRef.current = onHistoryLoaded;
  }, [onHistoryLoaded]);
  const [historyData, setHistoryData] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [deviceStatsData, setDeviceStatsData] = useState(null); // Device statistics from API
  const [historyLogsOpen, setHistoryLogsOpen] = useState(false);
  const [historyLogsData, setHistoryLogsData] = useState({ device_states: [], grid_prices: [] });
  const [historyLogsLoading, setHistoryLogsLoading] = useState(false);
  const [historyLogsError, setHistoryLogsError] = useState("");
  const [historyLogsTab, setHistoryLogsTab] = useState("device_state"); // "device_state" or "grid_price"

  // Load history CSV for graph display
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
          // Call callback for chart drawing if provided
          if (onHistoryLoadedRef.current) {
            onHistoryLoadedRef.current(text);
          }
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

  const loadHistoryLogs = async () => {
    setHistoryLogsError("");
    setHistoryLogsLoading(true);
    try {
      if (!RAILWAY_API_BASE_URL) {
        throw new Error("Backend API not configured");
      }
      
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const fetchUrl = `${base}/api/history-logs?limit=100`;
      
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `Failed to load history logs: ${res.status} ${res.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) {
            errorMsg = errorJson.error;
          }
        } catch (e) {
          if (errorText && errorText.trim()) {
            errorMsg = errorText.substring(0, 200);
          }
        }
        throw new Error(errorMsg);
      }
      
      const data = await res.json();
      if (data.ok) {
        setHistoryLogsData({
          device_states: data.device_states || [],
          grid_prices: data.grid_prices || []
        });
        setHistoryLogsOpen(true);
      } else {
        throw new Error(data.error || "Failed to load history logs");
      }
    } catch (e) {
      const errorMsg = e.message || String(e);
      setHistoryLogsError(errorMsg);
      handleApiError(e, setHistoryLogsError, "load history logs");
      console.error("History logs fetch error:", e);
    } finally {
      setHistoryLogsLoading(false);
    }
  };

  // Load device statistics from device table for Monthly Report calculations
  const loadDeviceStats = async () => {
    try {
      if (!RAILWAY_API_BASE_URL) {
        console.log("[Device Stats] API not configured");
        return; // API not configured
      }

      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      
      const res = await fetch(`${base}/api/device-stats?days=60`);
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          console.log("[Device Stats] Loaded:", json.deviceStats?.length || 0, "devices");
          setDeviceStatsData(json);
        } else {
          console.error("[Device Stats] API returned error:", json);
        }
      } else {
        const errorText = await res.text();
        console.error("[Device Stats] Failed to load:", res.status, errorText);
      }
    } catch (e) {
      console.error("[Device Stats] Fetch error:", e);
    }
  };

  // Setter function to update callback
  const setOnHistoryLoaded = useCallback((callback) => {
    onHistoryLoadedRef.current = callback;
  }, []);

  return {
    historyData,
    setHistoryData,
    historyError,
    deviceStatsData,
    historyLogsOpen,
    setHistoryLogsOpen,
    historyLogsData,
    historyLogsLoading,
    historyLogsError,
    historyLogsTab,
    setHistoryLogsTab,
    loadHistory,
    loadHistoryLogs,
    loadDeviceStats,
    setOnHistoryLoaded
  };
}

