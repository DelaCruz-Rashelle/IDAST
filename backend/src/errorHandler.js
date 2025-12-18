/**
 * Centralized error handling utility
 * Provides consistent error handling patterns across the application
 */

/**
 * Standard error response format
 * @param {Error|string} error - Error object or error message
 * @param {string} context - Context where error occurred (e.g., "API", "MQTT", "Database")
 * @param {number} statusCode - HTTP status code (default: 500)
 * @returns {Object} Standardized error response
 */
export function createErrorResponse(error, context = "API", statusCode = 500) {
  const errorMessage = error?.message || String(error);
  const errorStack = error?.stack;
  
  // Log error with context
  console.error(`[${context}] Error:`, errorMessage);
  if (errorStack && process.env.NODE_ENV !== "production") {
    console.error(`[${context}] Stack:`, errorStack);
  }
  
  return {
    ok: false,
    error: errorMessage,
    context,
    timestamp: new Date().toISOString()
  };
}

/**
 * Async error wrapper for route handlers
 * Catches errors and returns standardized error response
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped route handler
 */
export function asyncHandler(fn, context = "API") {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      const errorResponse = createErrorResponse(error, context);
      const statusCode = error?.statusCode || 500;
      res.status(statusCode).json(errorResponse);
    }
  };
}

/**
 * Handle MQTT-specific errors
 * @param {Error} error - Error object
 * @param {string} topic - MQTT topic (optional)
 * @param {string} message - MQTT message (optional)
 */
export function handleMqttError(error, topic = null, message = null) {
  const errorMessage = error?.message || String(error);
  console.error("[MQTT] Error:", errorMessage);
  if (topic) {
    console.error("[MQTT] Topic:", topic);
  }
  if (message) {
    console.error("[MQTT] Message preview:", message.toString().substring(0, 200));
  }
  if (error?.stack && process.env.NODE_ENV !== "production") {
    console.error("[MQTT] Stack:", error.stack);
  }
}

/**
 * Handle database-specific errors
 * @param {Error} error - Error object
 * @param {string} operation - Database operation (e.g., "query", "insert")
 */
export function handleDatabaseError(error, operation = "operation") {
  const errorMessage = error?.message || String(error);
  console.error(`[Database] ${operation} failed:`, errorMessage);
  if (error?.stack && process.env.NODE_ENV !== "production") {
    console.error(`[Database] Stack:`, error.stack);
  }
}

