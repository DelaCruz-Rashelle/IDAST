/**
 * Frontend error handling utility
 * Provides consistent error handling patterns for the dashboard
 */

/**
 * Format error message for display to user
 * @param {Error|string} error - Error object or error message
 * @param {string} context - Context where error occurred (e.g., "MQTT", "API", "Control")
 * @returns {string} User-friendly error message
 */
export function formatErrorMessage(error, context = "System") {
  const errorMessage = error?.message || String(error);
  
  // Log error for debugging
  if (process.env.NODE_ENV !== "production") {
    console.error(`[${context}] Error:`, errorMessage);
    if (error?.stack) {
      console.error(`[${context}] Stack:`, error.stack);
    }
  }
  
  // Return user-friendly message
  return errorMessage;
}

/**
 * Handle MQTT connection errors
 * @param {Error} error - Error object
 * @param {Function} setError - State setter for error message
 * @param {Function} setMqttConnected - State setter for connection status
 */
export function handleMqttError(error, setError, setMqttConnected) {
  const message = formatErrorMessage(error, "MQTT");
  setError(`MQTT connection error: ${message}`);
  setMqttConnected(false);
}

/**
 * Handle API request errors
 * @param {Error} error - Error object
 * @param {Function} setError - State setter for error message
 * @param {string} operation - Operation that failed (e.g., "fetching history")
 */
export function handleApiError(error, setError, operation = "API request") {
  const message = formatErrorMessage(error, "API");
  setError(`Failed to ${operation}: ${message}`);
}

/**
 * Handle control command errors
 * @param {Error} error - Error object
 * @param {Function} setError - State setter for error message
 * @param {string} command - Command that failed (e.g., "update grid price")
 */
export function handleControlError(error, setError, command = "send control command") {
  const message = formatErrorMessage(error, "Control");
  setError(`Failed to ${command}: ${message}`);
}

