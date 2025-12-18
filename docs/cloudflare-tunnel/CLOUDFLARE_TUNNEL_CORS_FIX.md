# Cloudflare Tunnel CORS Fix Documentation

> **⚠️ OBSOLETE**: This document describes the old HTTP-based architecture. The system now uses MQTT (EMQX Cloud) for all data communication. Tunneling is no longer required. See `docs/mqtt/MQTT_SETUP.md` for current setup instructions.

## Problem Description (Historical)

When deploying the Next.js application to Vercel, the app was unable to connect to the ESP32 device through the Cloudflare tunnel, even though the tunnel was working correctly when accessed directly in a browser.

**Note:** This issue is no longer relevant as the system has been migrated to MQTT-based architecture.

### Symptoms
- ✅ Cloudflare tunnel URL works when accessed directly in browser (shows real-time data)
- ❌ Vercel-deployed app shows error: "Connection Error: Cannot connect via Cloudflare tunnel. The ESP32 may not be connected to WiFi yet."
- ❌ Real-time data not reflecting in the deployed Vercel app

### Root Cause

The issue is caused by **CORS (Cross-Origin Resource Sharing) restrictions** enforced by web browsers:

1. **Direct Browser Access**: When you visit the Cloudflare tunnel URL directly (e.g., `https://xxxxx.trycloudflare.com`), you're making a request from the same origin, so there's no CORS issue.

2. **Vercel App Access**: When your Vercel-deployed app (e.g., `your-app.vercel.app`) tries to fetch data from the Cloudflare tunnel URL, it's a **cross-origin request**:
   - Origin: `https://your-app.vercel.app`
   - Target: `https://xxxxx.trycloudflare.com`
   - Browser blocks the request if proper CORS headers aren't present

3. **Why It Fails**: The ESP32 web server or Cloudflare tunnel doesn't send the necessary CORS headers (`Access-Control-Allow-Origin`, etc.) that would allow the Vercel app to access it from a different domain.

## Solution

The solution is to **proxy all tunnel requests through a Next.js API route**. This works because:

- **Server-side requests** (Next.js API routes) are not subject to browser CORS restrictions
- The API route runs on the same domain as your Vercel app, so browser-to-API requests are same-origin
- The API route can freely fetch from the Cloudflare tunnel without CORS issues

### Architecture

```
Browser (Vercel App)
    ↓ (Same-origin, no CORS)
Next.js API Route (/api/tunnel-proxy)
    ↓ (Server-side, no CORS)
Cloudflare Tunnel
    ↓
ESP32 Device
```

## Implementation

### 1. Created Tunnel Proxy API Route

**File**: `pages/api/tunnel-proxy.js`

This API route:
- Receives requests from the frontend
- Forwards them to the Cloudflare tunnel URL (from `NEXT_PUBLIC_API_BASE_URL`)
- Returns the response with proper CORS headers
- Handles both GET and POST requests
- Supports different content types (JSON, form-urlencoded, text)

### 2. Updated API URL Resolution

**File**: `pages/dashboard.js`

Modified the `getApiUrl()` function to:
- Use the proxy route (`/api/tunnel-proxy?endpoint=`) when `NEXT_PUBLIC_API_BASE_URL` is set
- Use the proxy route for custom tunnel URLs stored in localStorage
- Maintain backward compatibility with AP mode and proxy mode

### 3. Updated Fetch Functions

Updated all fetch calls in `dashboard.js`:
- `fetchData()` - Fetches telemetry data from `/data` endpoint
- `sendControl()` - Sends control commands to `/control` endpoint
- `loadHistory()` - Loads history data from `/api/history` endpoint

All functions now properly handle proxy URLs by appending the endpoint path.

## Configuration

### Environment Variable

Set the following environment variable in Vercel:

**Variable Name**: `NEXT_PUBLIC_API_BASE_URL`  
**Value**: Your Cloudflare tunnel URL (e.g., `https://xxxxx.trycloudflare.com`)

**Note**: Do NOT include a trailing slash in the URL.

### Setting in Vercel

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add a new variable:
   - **Key**: `NEXT_PUBLIC_API_BASE_URL`
   - **Value**: Your Cloudflare tunnel URL
   - **Environment**: Production (and Preview if needed)
4. Redeploy your application

## How It Works

### Request Flow

1. **Frontend Request**:
   ```javascript
   fetch('/api/tunnel-proxy?endpoint=/data')
   ```

2. **API Route Processing**:
   ```javascript
   // Reads NEXT_PUBLIC_API_BASE_URL from environment
   const tunnelUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
   const fullUrl = `${tunnelUrl}/data`;
   
   // Server-side fetch (no CORS restrictions)
   const response = await fetch(fullUrl);
   ```

3. **Response**:
   ```javascript
   // Returns data with CORS headers
   res.setHeader('Access-Control-Allow-Origin', '*');
   return res.json(data);
   ```

### Supported Endpoints

The proxy automatically handles these ESP32 endpoints:
- `/data` - Telemetry data (GET)
- `/control` - Control commands (POST, form-urlencoded)
- `/api/history` - History data (GET, text/CSV)

## Testing

### Verify the Fix

1. **Check Environment Variable**:
   - Ensure `NEXT_PUBLIC_API_BASE_URL` is set in Vercel
   - Verify the URL is correct (no trailing slash)

2. **Test Direct Tunnel Access**:
   - Visit the tunnel URL directly in browser
   - Confirm ESP32 data is visible

3. **Test Vercel App**:
   - Visit your deployed Vercel app
   - Check browser console for errors
   - Verify real-time data is loading

4. **Check Network Tab**:
   - Open browser DevTools → Network tab
   - Look for requests to `/api/tunnel-proxy`
   - Verify they return 200 status codes

### Troubleshooting

#### Issue: Still getting CORS errors
- **Check**: Is `NEXT_PUBLIC_API_BASE_URL` set correctly?
- **Check**: Did you redeploy after setting the environment variable?
- **Check**: Browser console for specific error messages

#### Issue: 400 Bad Request
- **Check**: Tunnel URL format (should be `https://xxxxx.trycloudflare.com`, no trailing slash)
- **Check**: Vercel environment variable is set for the correct environment (Production/Preview)

#### Issue: 500 Internal Server Error
- **Check**: Is the Cloudflare tunnel running?
- **Check**: Can you access the tunnel URL directly in browser?
- **Check**: Vercel function logs for detailed error messages

#### Issue: Data not updating
- **Check**: ESP32 is connected to WiFi
- **Check**: ESP32 web server is running
- **Check**: Tunnel is pointing to correct ESP32 IP address

## Benefits

1. **No CORS Issues**: All requests go through same-origin API route
2. **Secure**: Tunnel URL stored server-side, not exposed to client
3. **Flexible**: Supports multiple content types and HTTP methods
4. **Maintainable**: Centralized proxy logic, easy to debug
5. **Backward Compatible**: Still supports AP mode and direct proxy mode

## Files Modified

1. **Created**: `pages/api/tunnel-proxy.js` - New API route for tunnel proxying
2. **Modified**: `pages/dashboard.js` - Updated API URL resolution and fetch functions

## Additional Notes

- The proxy route handles CORS preflight (OPTIONS) requests automatically
- Both JSON and form-urlencoded POST requests are supported
- Text responses (like CSV history) are properly forwarded
- Error messages are enhanced for better debugging

## Future Improvements

Potential enhancements:
- Add request caching for telemetry data
- Implement request timeout handling
- Add rate limiting
- Support for WebSocket connections (if needed)
- Add request logging/monitoring

