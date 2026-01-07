import { useState, useRef } from "react";
import { handleControlError } from "../utils/errorHandler.js";

const RAILWAY_API_BASE_URL = process.env.NEXT_PUBLIC_RAILWAY_API_BASE_URL || "";

/**
 * Custom hook for grid price loading, saving, and validation
 * @param {Function} sendControl - MQTT control command function
 * @param {Function} setError - Error state setter
 * @returns {Object} Grid price state and functions
 */
export function useGridPrice(sendControl, setError) {
  const [gridPrice, setGridPrice] = useState("");
  const [savedGridPrice, setSavedGridPrice] = useState(null); // Track saved price for calculations
  
  const gridPriceInputFocusedRef = useRef(false);
  const gridPriceLoadedFromDbRef = useRef(false);

  // Load grid price from database
  const loadGridPrice = async () => {
    if (!RAILWAY_API_BASE_URL) return;
    
    // Don't load if user is currently typing in the input field
    if (typeof window !== "undefined" && 
        (document.activeElement?.id === "gridPrice" || gridPriceInputFocusedRef.current)) {
      return;
    }
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      const res = await fetch(`${base}/api/grid-price`);
      if (res.ok) {
        const json = await res.json();
        // Only update if input is not focused and not already loaded from DB (user might have typed something)
        if (json.price !== null && json.price !== undefined && 
            typeof window !== "undefined" && 
            document.activeElement?.id !== "gridPrice" &&
            !gridPriceInputFocusedRef.current &&
            !gridPriceLoadedFromDbRef.current) {
          const price = json.price.toFixed(2);
          setGridPrice(price);
          setSavedGridPrice(parseFloat(price)); // Set saved price for calculations
          gridPriceLoadedFromDbRef.current = true; // Mark that we've loaded from DB
        } else if (json.price === null || json.price === undefined) {
          // No saved price, but only clear if user hasn't typed anything
          if (!gridPriceInputFocusedRef.current && gridPrice === "") {
            setGridPrice("");
            gridPriceLoadedFromDbRef.current = false; // Allow user to input
          }
        }
      } else {
        // API call failed, but only clear if user hasn't typed anything
        if (!gridPriceInputFocusedRef.current && gridPrice === "") {
          setGridPrice("");
          gridPriceLoadedFromDbRef.current = false;
        }
      }
    } catch (e) {
      console.error("Failed to load grid price:", e);
      // Don't show error to user for this - it's okay if it fails
      // Only clear if user hasn't typed anything
      if (!gridPriceInputFocusedRef.current && gridPrice === "") {
        setGridPrice("");
        gridPriceLoadedFromDbRef.current = false;
      }
    }
  };

  // Save grid price to database
  const saveGridPrice = async (price) => {
    if (!RAILWAY_API_BASE_URL) {
      throw new Error("Backend API not configured");
    }
    
    try {
      const base = RAILWAY_API_BASE_URL.endsWith("/")
        ? RAILWAY_API_BASE_URL.slice(0, -1)
        : RAILWAY_API_BASE_URL;
      
      const res = await fetch(`${base}/api/grid-price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: parseFloat(price) })
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `Failed to save grid price: ${res.status} ${res.statusText}`;
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
      // Mark that we've saved to DB, so telemetry won't overwrite it
      gridPriceLoadedFromDbRef.current = true;
      
      // Return the response data including estimated_savings
      return data;
    } catch (e) {
      console.error("Failed to save grid price:", e);
      throw e; // Re-throw so caller can handle error
    }
  };

  // Handle grid price save
  const handleSaveGridPrice = async () => {
    try {
      const price = parseFloat(gridPrice);
      if (isNaN(price) || price <= 0 || price >= 100000) {
        setError("Invalid price (must be 0 to 100,000 cents/kWh)");
        setGridPrice("");
        return;
      }
      
      // Send to MQTT if available (non-blocking)
      try {
        await sendControl({ newPrice: price });
      } catch (mqttError) {
        console.warn("MQTT send failed (non-critical):", mqttError);
        // Continue even if MQTT fails
      }
      
      // Save to database and get response with estimated_savings
      const response = await saveGridPrice(price);
      
      // Update saved price for calculations
      setSavedGridPrice(price);
      setError("");
      
      // Log success with estimated savings if available
      if (response.estimated_savings !== null && response.estimated_savings !== undefined) {
        console.log(`Grid price saved. Estimated savings: ₱${response.estimated_savings.toFixed(2)}`);
      }
      
      // Auto-scroll to Estimated Savings section after saving
      setTimeout(() => {
        const estimatedSavingsElement = document.getElementById("estimated-savings-row");
        if (estimatedSavingsElement) {
          estimatedSavingsElement.scrollIntoView({ 
            behavior: "smooth", 
            block: "center" 
          });
        }
      }, 100); // Small delay to ensure state update is reflected
    } catch (error) {
      handleControlError(error, setError, "save grid price");
    }
  };

  return {
    gridPrice,
    setGridPrice,
    savedGridPrice,
    setSavedGridPrice,
    gridPriceInputFocusedRef,
    gridPriceLoadedFromDbRef,
    loadGridPrice,
    saveGridPrice,
    handleSaveGridPrice
  };
}

