# Security & Error Handling Improvements

This document outlines the security and error handling improvements implemented.

## Changes Made

### 1. Removed Hardcoded Credentials (Frontend)

**File:** `pages/login.js`

**Changes:**
- Removed default values for `NEXT_PUBLIC_LOGIN_EMAIL` and `NEXT_PUBLIC_LOGIN_PASSWORD`
- Now requires environment variables to be set explicitly
- Added validation to check if credentials are configured before allowing login

**Before:**
```javascript
const VALID_EMAIL = process.env.NEXT_PUBLIC_LOGIN_EMAIL || "admin@barangayhidalgo.gov.ph";
const VALID_PASSWORD = process.env.NEXT_PUBLIC_LOGIN_PASSWORD || "solar2024";
```

**After:**
```javascript
const VALID_EMAIL = process.env.NEXT_PUBLIC_LOGIN_EMAIL;
const VALID_PASSWORD = process.env.NEXT_PUBLIC_LOGIN_PASSWORD;
```

**Security Impact:** Prevents credentials from being exposed in client-side code. Users must configure environment variables in Vercel.

---

### 2. Restricted CORS Configuration (Backend)

**File:** `backend/src/server.js`

**Changes:**
- Changed from allowing all origins (`*`) to only allowing configured origins
- Added `ALLOWED_ORIGINS` environment variable support (comma-separated list)
- Added security logging for blocked requests

**Before:**
```javascript
res.setHeader("Access-Control-Allow-Origin", "*");
```

**After:**
```javascript
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim())
  : [];

const origin = req.headers.origin;
if (origin && allowedOrigins.includes(origin)) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  // ... other headers
} else if (origin) {
  console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
}
```

**Security Impact:** Prevents unauthorized domains from making API requests. Only configured origins are allowed.

**Configuration Required:**
Set `ALLOWED_ORIGINS` environment variable in Railway:
```
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app,https://your-custom-domain.com
```

---

### 3. Centralized Error Handling

#### Backend Error Handler

**File:** `backend/src/errorHandler.js` (NEW)

**Features:**
- Standardized error response format
- Context-aware error logging
- Async route handler wrapper
- Specialized handlers for MQTT and database errors

**Key Functions:**
- `createErrorResponse(error, context, statusCode)` - Standard error response
- `asyncHandler(fn, context)` - Wraps async route handlers with error catching
- `handleMqttError(error, topic, message)` - MQTT-specific error handling
- `handleDatabaseError(error, operation)` - Database-specific error handling

**Usage Example:**
```javascript
app.get("/api/endpoint", asyncHandler(async (req, res) => {
  // Route handler code
  // Errors are automatically caught and formatted
}, "API"));
```

#### Frontend Error Handler

**File:** `utils/errorHandler.js` (NEW)

**Features:**
- User-friendly error message formatting
- Context-aware error handling
- Specialized handlers for MQTT, API, and control errors

**Key Functions:**
- `formatErrorMessage(error, context)` - Formats errors for display
- `handleMqttError(error, setError, setMqttConnected)` - MQTT connection errors
- `handleApiError(error, setError, operation)` - API request errors
- `handleControlError(error, setError, command)` - Control command errors

**Usage Example:**
```javascript
try {
  await sendControl({ newPrice: price });
} catch (error) {
  handleControlError(error, setError, "update grid price");
}
```

---

### 4. Updated Files to Use Centralized Error Handling

**Backend Files Updated:**
- `backend/src/server.js` - All routes now use `asyncHandler`
- `backend/src/ingest.js` - Uses `handleMqttError` and `handleDatabaseError`
- `backend/src/db.js` - Uses `handleDatabaseError`

**Frontend Files Updated:**
- `pages/dashboard.js` - Uses error handler utilities for MQTT, API, and control errors

---

## Environment Variables Required

### Frontend (Vercel)
- `NEXT_PUBLIC_LOGIN_EMAIL` - Admin email (required, no default)
- `NEXT_PUBLIC_LOGIN_PASSWORD` - Admin password (required, no default)
- `NEXT_PUBLIC_MQTT_BROKER_URL` - MQTT broker WebSocket URL
- `NEXT_PUBLIC_MQTT_USERNAME` - MQTT username (optional)
- `NEXT_PUBLIC_MQTT_PASSWORD` - MQTT password (optional)
- `NEXT_PUBLIC_RAILWAY_API_BASE_URL` - Backend API base URL

### Backend (Railway)
- `ALLOWED_ORIGINS` - Comma-separated list of allowed CORS origins (required)
  - Example: `https://your-app.vercel.app,https://your-domain.com`
- `MQTT_BROKER_URL` - MQTT broker URL
- `MQTT_USERNAME` - MQTT username (optional)
- `MQTT_PASSWORD` - MQTT password (optional)
- Database connection variables (MYSQL_HOST, etc.)

---

## Migration Guide

### Step 1: Update Frontend Environment Variables (Vercel)

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add/Update:
   - `NEXT_PUBLIC_LOGIN_EMAIL` = your admin email
   - `NEXT_PUBLIC_LOGIN_PASSWORD` = your admin password
3. Redeploy the application

### Step 2: Update Backend Environment Variables (Railway)

1. Go to Railway Dashboard → Your Service → Variables
2. Add:
   - `ALLOWED_ORIGINS` = `https://your-vercel-app.vercel.app`
   - (Add multiple origins separated by commas if needed)
3. Restart the service

### Step 3: Verify

1. Test login with configured credentials
2. Verify CORS is working (check browser console for CORS errors)
3. Check backend logs for any CORS warnings

---

## Security Benefits

1. **No Hardcoded Credentials**: Credentials must be set via environment variables
2. **Restricted CORS**: Only configured origins can access the API
3. **Consistent Error Handling**: Errors are logged consistently and don't expose sensitive information
4. **Better Monitoring**: CORS violations are logged for security monitoring

---

## Notes

- If `ALLOWED_ORIGINS` is not set, no origins will be allowed (most secure, but API won't work)
- Frontend login will show an error if credentials are not configured
- All error messages are user-friendly and don't expose internal details in production

