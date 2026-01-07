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
  const [historyLoading, setHistoryLoading] = useState(false); // Loading state for history fetch
  const [deviceStatsData, setDeviceStatsData] = useState(null); // Device statistics from API
  const [deviceStatsError, setDeviceStatsError] = useState(""); // Error state for device stats
  const [deviceStatsLoading, setDeviceStatsLoading] = useState(false); // Loading state for device stats
  const [historyLogsOpen, setHistoryLogsOpen] = useState(false);
  const [historyLogsData, setHistoryLogsData] = useState({ device_states: [], devices: [], grid_prices: [] });
  const [historyLogsLoading, setHistoryLogsLoading] = useState(false);
  const [historyLogsError, setHistoryLogsError] = useState("");
  const [historyLogsTab, setHistoryLogsTab] = useState("devices"); // "devices" or "grid_price"

  // Load history CSV for graph display
  const loadHistory = useCallback(async () => {
    setHistoryError(""); // Clear previous errors
    setHistoryLoading(true); // Set loading state to prevent flickering
    let fetchUrl = ""; // Declare outside try for error logging
    try {
      // Prefer Railway DB-backed history if configured (keeps realtime via ESP32 tunnel unchanged)
      if (RAILWAY_API_BASE_URL) {
        const base = RAILWAY_API_BASE_URL.endsWith("/")
          ? RAILWAY_API_BASE_URL.slice(0, -1)
          : RAILWAY_API_BASE_URL;
        fetchUrl = `${base}/api/history.csv?days=60`;
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const res = await fetch(fetchUrl, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const text = await res.text();
          setHistoryData(text);
          setHistoryError(""); // Clear any previous errors on success
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
      setHistoryError(errorMsg);
      console.error("Railway API base URL not configured");
      
    } catch (e) {
      // Handle network errors and other exceptions
      let errorMsg = e.message || String(e);
      
      // Handle timeout errors
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        errorMsg = "Request timed out. The server may be slow or overloaded. Please try again.";
        console.error("History fetch timeout:", e);
      } 
      // Handle resource limit errors
      else if (errorMsg.includes("ERR_INSUFFICIENT_RESOURCES") || errorMsg.includes("Insufficient")) {
        errorMsg = "Too many requests. Please wait a moment and refresh the page.";
        console.warn("History fetch resource limit:", e);
      }
      // Handle other network errors
      else if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("fetch")) {
        if (!RAILWAY_API_BASE_URL) {
          errorMsg = "Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.";
        } else {
          errorMsg = `Unable to connect to backend API. Please check if the server is running and accessible at ${RAILWAY_API_BASE_URL}`;
        }
      }
      
      setHistoryError(errorMsg);
      console.error("History fetch error:", e);
      console.error("Failed URL:", fetchUrl);
    } finally {
      setHistoryLoading(false); // Clear loading state
    }
  }, []);

  const loadHistoryLogs = async () => {
    setHistoryLogsError("");
    setHistoryLogsLoading(true);
    // Open modal immediately so user can see loading state or errors
    setHistoryLogsOpen(true);
    let fetchUrl = ""; // Declare outside try for error logging
    try {
      if (!RAILWAY_API_BASE_URL) {
        throw new Error("Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.");
      }
      
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      fetchUrl = `${base}/api/history-logs?limit=100`;
      
      console.log("[History Logs] Fetching from:", fetchUrl);
      
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
          device_states: data.device_states || [], // Empty for backward compatibility
          devices: data.devices || [], // Device registration data
          grid_prices: data.grid_prices || []
        });
        setHistoryLogsError(""); // Clear any previous errors on success
      } else {
        throw new Error(data.error || "Failed to load history logs");
      }
    } catch (e) {
      // Handle network errors and other exceptions
      let errorMsg = e.message || String(e);
      
      // If it's a network error, provide a more user-friendly message
      if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("fetch")) {
        if (!RAILWAY_API_BASE_URL) {
          errorMsg = "Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.";
        } else {
          errorMsg = `Unable to connect to backend API at ${fetchUrl || RAILWAY_API_BASE_URL}. Please check if the server is running and the endpoint exists.`;
        }
      }
      
      setHistoryLogsError(errorMsg);
      console.error("History logs fetch error:", e);
      console.error("Failed URL:", fetchUrl);
      console.error("Railway API Base URL:", RAILWAY_API_BASE_URL);
    } finally {
      setHistoryLogsLoading(false);
    }
  };

  // Load device statistics from device table for Monthly Report calculations
  const loadDeviceStats = useCallback(async () => {
    setDeviceStatsError(""); // Clear previous errors
    setDeviceStatsLoading(true); // Set loading state
    let fetchUrl = ""; // Declare outside try for error logging
    try {
      if (!RAILWAY_API_BASE_URL) {
        const errorMsg = "Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.";
        setDeviceStatsError(errorMsg);
        console.log("[Device Stats] API not configured");
        return; // API not configured
      }

      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      
      fetchUrl = `${base}/api/device-stats?days=60`;
      console.log("[Device Stats] Fetching from:", fetchUrl);
      
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const res = await fetch(fetchUrl, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          console.log("[Device Stats] Loaded:", json.deviceStats?.length || 0, "devices");
          setDeviceStatsData(json);
          setDeviceStatsError(""); // Clear any previous errors on success
        } else {
          const errorMsg = json.error || "Failed to load device statistics";
          setDeviceStatsError(errorMsg);
          console.error("[Device Stats] API returned error:", json);
        }
      } else {
        const errorText = await res.text();
        let errorMsg = `Device stats fetch failed: ${res.status} ${res.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) {
            errorMsg = `Device stats error: ${errorJson.error}`;
          }
        } catch (e) {
          if (errorText && errorText.trim()) {
            errorMsg = `Device stats error: ${errorText.substring(0, 200)}`;
          }
        }
        setDeviceStatsError(errorMsg);
        console.error("[Device Stats] Failed to load:", res.status, errorText);
      }
    } catch (e) {
      // Handle timeout and network errors gracefully
      let errorMsg = e.message || String(e);
      
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        errorMsg = "Request timed out. The server may be slow or overloaded. Please try again.";
        console.error("[Device Stats] Request timeout:", e);
      } else if (errorMsg.includes('ERR_INSUFFICIENT_RESOURCES') || errorMsg.includes('Insufficient')) {
        errorMsg = "Too many requests. Please wait a moment and refresh the page.";
        console.warn("[Device Stats] Browser resource limit reached");
      } else if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError") || errorMsg.includes("fetch")) {
        if (!RAILWAY_API_BASE_URL) {
          errorMsg = "Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.";
        } else {
          errorMsg = `Unable to connect to backend API. Please check if the server is running and accessible at ${RAILWAY_API_BASE_URL}`;
        }
        console.error("[Device Stats] Fetch error:", e);
      } else {
        console.error("[Device Stats] Fetch error:", e);
      }
      
      setDeviceStatsError(errorMsg);
      console.error("[Device Stats] Failed URL:", fetchUrl);
    } finally {
      setDeviceStatsLoading(false); // Clear loading state
    }
  }, []);

  // Setter function to update callback
  const setOnHistoryLoaded = useCallback((callback) => {
    onHistoryLoadedRef.current = callback;
  }, []);

  return {
    historyData,
    setHistoryData,
    historyError,
    historyLoading,
    deviceStatsData,
    deviceStatsError,
    deviceStatsLoading,
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

