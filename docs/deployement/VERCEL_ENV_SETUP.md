# Vercel Environment Variable Setup for Railway Backend

This guide helps you verify and configure the `NEXT_PUBLIC_RAILWAY_API_BASE_URL` environment variable in Vercel to connect to your Railway backend API.

## Environment Variable Name

**Correct Variable Name:** `NEXT_PUBLIC_RAILWAY_API_BASE_URL`

✅ This is the correct name used throughout the codebase.

## Getting Your Railway Backend URL

### Step 1: Find Your Railway Service Public URL

1. Log in to [Railway Dashboard](https://railway.app)
2. Select your project
3. Click on your **backend service** (not the MySQL database)
4. Go to the **"Settings"** tab
5. Scroll down to **"Networking"** section
6. Find **"Public Domain"** or **"Generate Domain"**

### Step 2: Copy the Public URL

Railway provides a public URL in one of these formats:

**Option A: Railway-generated domain (recommended)**
```
https://your-service-name.up.railway.app
```

**Option B: Custom domain (if configured)**
```
https://api.yourdomain.com
```

### Step 3: Verify the URL Format

✅ **Correct Format:**
- Starts with `https://`
- No trailing slash at the end
- Example: `https://idast-backend.up.railway.app`

❌ **Incorrect Formats:**
- `https://idast-backend.up.railway.app/` (has trailing slash - will be auto-fixed but avoid it)
- `http://idast-backend.up.railway.app` (missing 's' in https)
- `idast-backend.up.railway.app` (missing protocol)

## Setting in Vercel

### Step 1: Access Environment Variables

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**

### Step 2: Add/Update the Variable

1. **If variable doesn't exist:**
   - Click **"Add New"**
   - **Key:** `NEXT_PUBLIC_RAILWAY_API_BASE_URL`
   - **Value:** Your Railway backend URL (e.g., `https://idast-backend.up.railway.app`)
   - **Environment:** Select **Production**, **Preview**, and **Development** (or as needed)

2. **If variable exists:**
   - Click the **three dots** (⋯) next to the variable
   - Click **"Edit"**
   - Update the **Value** field with your Railway URL
   - Click **"Save"**

### Step 3: Redeploy

**Important:** After adding or updating environment variables, you must redeploy:

1. Go to **Deployments** tab
2. Click the **three dots** (⋯) on the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete

## Verifying the Configuration

### Test 1: Check Railway Backend is Running

1. Open your Railway backend URL in a browser:
   ```
   https://your-backend-url.up.railway.app
   ```
2. You should see:
   ```
   IDAST telemetry backend running
   ```

### Test 2: Test API Endpoint

1. Visit:
   ```
   https://your-backend-url.up.railway.app/api/history.csv?days=60
   ```
2. You should see CSV data or an empty CSV with headers

### Test 3: Check Browser Console

1. Open your Vercel app
2. Open browser DevTools (F12)
3. Go to **Console** tab
4. Look for any errors mentioning:
   - "Failed to fetch"
   - "Backend API not configured"
   - Network errors

### Test 4: Check Network Tab

1. Open browser DevTools (F12)
2. Go to **Network** tab
3. Refresh the page
4. Look for requests to:
   - `/api/history.csv`
   - `/api/device-stats`
   - `/api/grid-price`
5. Check if they return **200 OK** or error status codes

## Common Issues and Solutions

### Issue 1: "Backend API not configured"

**Error Message:**
```
Backend API not configured. Please set NEXT_PUBLIC_RAILWAY_API_BASE_URL environment variable.
```

**Causes:**
- Variable not set in Vercel
- Variable name is misspelled
- Deployment happened before variable was added

**Solutions:**
1. Verify variable name is exactly: `NEXT_PUBLIC_RAILWAY_API_BASE_URL`
2. Check variable is set for the correct environment (Production/Preview)
3. **Redeploy** after adding/updating the variable

### Issue 2: "Unable to connect to backend API"

**Error Message:**
```
Unable to connect to backend API. Please check if the server is running and accessible at https://...
```

**Causes:**
- Railway backend is not running
- Railway URL is incorrect
- Railway service is paused or deleted
- Network/CORS issues

**Solutions:**
1. **Check Railway Service Status:**
   - Go to Railway dashboard
   - Verify backend service shows **"Active"** status
   - Check deployment logs for errors

2. **Verify Railway URL:**
   - Test the URL directly in browser
   - Should show: `IDAST telemetry backend running`
   - If you get 404 or connection error, URL is wrong

3. **Check Railway Service Settings:**
   - Go to backend service → **Settings** → **Networking**
   - Ensure **"Public Domain"** is enabled
   - Copy the exact URL shown

4. **Verify URL Format:**
   - Must start with `https://`
   - No trailing slash
   - Example: `https://idast-backend.up.railway.app`

### Issue 3: CORS Errors

**Error Message:**
```
Access to fetch at '...' from origin '...' has been blocked by CORS policy
```

**Causes:**
- Backend CORS configuration issue
- Wrong URL format

**Solutions:**
- Backend should already allow all origins (`*`)
- Verify you're using the correct Railway public URL
- Check Railway backend logs for CORS-related errors

### Issue 4: 404 Not Found

**Error Message:**
```
404 Not Found
```

**Causes:**
- Wrong URL path
- Backend endpoint doesn't exist
- Railway service is not the backend service

**Solutions:**
1. Verify you're using the **backend service** URL, not MySQL database URL
2. Test the root URL first: `https://your-backend.up.railway.app`
3. Then test API endpoint: `https://your-backend.up.railway.app/api/history.csv`

### Issue 5: Variable Not Updating After Redeploy

**Causes:**
- Browser cache
- Old deployment still running
- Variable set for wrong environment

**Solutions:**
1. **Hard refresh browser:** Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. **Clear browser cache** for the Vercel domain
3. **Verify environment:** Ensure variable is set for **Production** if you're viewing production deployment
4. **Check deployment logs:** Verify the new deployment actually started

## Quick Checklist

Before reporting issues, verify:

- [ ] Variable name is exactly: `NEXT_PUBLIC_RAILWAY_API_BASE_URL`
- [ ] Variable value is your Railway backend public URL
- [ ] URL starts with `https://`
- [ ] URL has no trailing slash
- [ ] Variable is set for the correct environment (Production/Preview)
- [ ] You redeployed after adding/updating the variable
- [ ] Railway backend service shows "Active" status
- [ ] Railway backend URL works when opened directly in browser
- [ ] Browser console shows no CORS errors
- [ ] Network tab shows API requests (even if they fail)

## Example Configuration

**Vercel Environment Variable:**
```
Key: NEXT_PUBLIC_RAILWAY_API_BASE_URL
Value: https://idast-backend-production.up.railway.app
Environment: Production, Preview, Development
```

**Expected API Endpoints:**
- History CSV: `https://idast-backend-production.up.railway.app/api/history.csv?days=60`
- Device Stats: `https://idast-backend-production.up.railway.app/api/device-stats?days=60`
- Grid Price: `https://idast-backend-production.up.railway.app/api/grid-price`
- History Logs: `https://idast-backend-production.up.railway.app/api/history-logs?limit=100`

## Still Having Issues?

If you've verified all the above and still have problems:

1. **Check Railway Backend Logs:**
   - Go to Railway → Backend Service → Deployments
   - View latest deployment logs
   - Look for errors or warnings

2. **Check Vercel Deployment Logs:**
   - Go to Vercel → Deployments
   - View latest deployment logs
   - Look for build errors

3. **Test Railway URL Directly:**
   - Open Railway URL in browser
   - Test API endpoints manually
   - Verify backend is responding

4. **Check Browser Console:**
   - Open DevTools → Console
   - Look for specific error messages
   - Check Network tab for failed requests

