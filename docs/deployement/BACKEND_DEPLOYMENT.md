# Backend Deployment Guide

This document provides step-by-step instructions for deploying the IDAST telemetry backend service to Railway, including MySQL database setup, environment configuration, and API endpoints.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Railway MySQL Setup](#railway-mysql-setup)
4. [Backend Service Deployment](#backend-service-deployment)
5. [Environment Variables](#environment-variables)
6. [Automatic Schema Initialization](#automatic-schema-initialization)
7. [API Endpoints](#api-endpoints)
8. [Telemetry Ingestion Service](#telemetry-ingestion-service)
9. [Troubleshooting](#troubleshooting)
10. [Local Development](#local-development)

---

## Overview

The IDAST telemetry backend is an Express.js service that:
- Stores ESP32 telemetry data in a MySQL database
- Provides REST API endpoints for querying telemetry data
- Automatically ingests telemetry from ESP32 devices via Cloudflare tunnel
- Automatically creates database tables on startup

**Tech Stack:**
- Node.js 18+ (ES Modules)
- Express.js 4.x
- MySQL 9.x (via Railway)
- mysql2/promise for database connections

---

## Prerequisites

Before deploying, ensure you have:

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **GitHub Repository**: Your backend code pushed to GitHub
3. **Cloudflare Tunnel URL**: (Optional) If using telemetry ingestion, you need a Cloudflare tunnel URL pointing to your ESP32 device
4. **Node.js 18+**: Required for local development/testing

---

## Railway MySQL Setup

### Step 1: Create MySQL Service

1. Log in to Railway dashboard
2. Click **"New Project"** or select an existing project
3. Click **"New"** → **"Database"** → **"Add MySQL"**
4. Railway will provision a MySQL 9.x database instance

### Step 2: Get Connection Details

After MySQL is provisioned:

1. Click on your MySQL service
2. Go to the **"Variables"** tab
3. Railway automatically provides these environment variables:
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_DATABASE`
   - `MYSQL_URL` (connection string format)

**Note:** Railway may also provide `DATABASE_URL` which the backend supports as an alternative.

### Step 3: Verify MySQL is Running

1. Go to the **"Deployments"** tab
2. Check that the deployment shows **"ACTIVE"** status
3. View logs to confirm MySQL started successfully:
   ```
   mysqld: ready for connections. Version: '9.4.0' port: 3306
   ```

---

## Backend Service Deployment

### Step 1: Create Backend Service

1. In your Railway project, click **"New"** → **"GitHub Repo"**
2. Select your repository
3. Railway will detect it's a Node.js project

### Step 2: Configure Service Settings

1. **Root Directory**: Set to `backend/` (if your backend code is in a subdirectory)
2. **Build Command**: Railway auto-detects, but you can set:
   ```
   npm install
   ```
3. **Start Command**: Railway auto-detects from `package.json`:
   ```
   npm start
   ```
   Which runs: `node src/server.js`

### Step 3: Connect MySQL to Backend

1. In your backend service, go to **"Variables"** tab
2. Click **"New Variable"** → **"Reference"**
3. Select your MySQL service
4. Railway will automatically add all MySQL connection variables:
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_DATABASE`
   - `MYSQL_URL`

**Important:** Railway automatically injects these variables when you reference the MySQL service. You don't need to manually copy values.

### Step 4: Deploy

1. Railway will automatically deploy when you push to GitHub
2. Or manually trigger deployment: **"Deployments"** → **"Redeploy"**
3. Monitor logs in the **"Deployments"** tab

### Step 5: Verify Deployment

Check backend logs for:

```
Database schema initialized (telemetry table ready)
Listening on port 3000
Ingest loop starting: every 10000ms
```

Visit your backend URL (provided by Railway) to see:
```
IDAST telemetry backend running
```

---

## Environment Variables

### Required Variables

These are automatically provided by Railway when you connect the MySQL service:

| Variable | Description | Source |
|----------|-------------|--------|
| `MYSQL_HOST` | MySQL server hostname | Railway MySQL service |
| `MYSQL_PORT` | MySQL server port (usually 3306) | Railway MySQL service |
| `MYSQL_USER` | MySQL username | Railway MySQL service |
| `MYSQL_PASSWORD` | MySQL password | Railway MySQL service |
| `MYSQL_DATABASE` | Database name | Railway MySQL service |
| `MYSQL_URL` | Connection string (alternative) | Railway MySQL service |
| `PORT` | Backend server port | Railway (default: 3000) |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TUNNEL_BASE_URL` | Cloudflare tunnel URL for ESP32 | Required if `INGEST_ENABLED=true` |
| `INGEST_ENABLED` | Enable telemetry ingestion loop | `true` |
| `INGEST_INTERVAL_MS` | Ingestion interval in milliseconds | `10000` (10 seconds) |
| `DATABASE_URL` | Alternative MySQL connection string | Uses individual MySQL vars if not set |

### Setting Optional Variables

1. Go to your backend service → **"Variables"** tab
2. Click **"New Variable"**
3. Add variables as needed:

**Example: Enable Ingestion with Custom Interval**
```
TUNNEL_BASE_URL=https://your-tunnel.trycloudflare.com
INGEST_ENABLED=true
INGEST_INTERVAL_MS=5000
```

**Example: Disable Ingestion**
```
INGEST_ENABLED=false
```

---

## Automatic Schema Initialization

The backend **automatically creates the database schema** when it starts. You do **not** need to manually run SQL scripts.

### How It Works

1. On startup, the backend calls `initSchema()` from `backend/src/db.js`
2. This function creates the `telemetry` table if it doesn't exist
3. Uses `CREATE TABLE IF NOT EXISTS`, so it's safe to run multiple times
4. If schema creation fails, the backend exits with an error

### Schema Details

The `telemetry` table includes:
- **Primary Key**: `id` (auto-incrementing BIGINT)
- **Timestamp**: `ts` (TIMESTAMP(3) with millisecond precision)
- **Device Info**: `device_name`
- **Sensor Data**: `top`, `left`, `right`, `avg`, `horizontal_error`, `vertical_error`
- **Tracking Data**: `tilt_angle`, `pan_angle`, `pan_target`, `manual`, `steady`
- **Power Metrics**: `power_w`, `power_actual_w`, `temp_c`
- **Battery**: `battery_pct`, `battery_v`, `efficiency`
- **Energy**: `energy_wh`, `energy_kwh`
- **Environmental**: `co2_kg`, `trees`, `phones`, `phone_minutes`, `pesos`, `grid_price`
- **Raw Data**: `raw_json` (JSON column storing full telemetry packet)
- **Index**: `idx_ts` on `ts` column for fast time-based queries

### Manual Schema (Optional)

If you need to manually inspect or modify the schema, the SQL is available in:
- `backend/schema.sql` (reference file)
- `backend/src/db.js` (actual implementation)

---

## API Endpoints

### Health Check

**GET** `/health`

Checks database connectivity.

**Response:**
```json
{
  "ok": true
}
```

**Error Response:**
```json
{
  "ok": false,
  "error": "Error message"
}
```

---

### Status

**GET** `/`

Simple text response confirming the backend is running.

**Response:**
```
IDAST telemetry backend running
```

---

### Latest Telemetry

**GET** `/api/latest`

Returns the most recent telemetry record.

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": 123,
    "ts": "2025-12-16T22:30:00.000Z",
    "device_name": "ESP32-Solar",
    "power_w": 45.2,
    "battery_pct": 87.5,
    ...
  }
}
```

**Empty Response:**
```json
{
  "ok": true,
  "data": null
}
```

---

### History CSV

**GET** `/api/history.csv?days=60`

Returns historical telemetry data in CSV format compatible with the dashboard's history parser.

**Query Parameters:**
- `days` (optional): Number of days to retrieve (default: 60, max: 365)

**Response Format:**
```csv
timestamp,energy_wh,battery_pct,device_name,session_min
1702761600,1250.5,87.5,ESP32-Solar,120
1702848000,1320.2,89.1,ESP32-Solar,135
...
```

**Data Aggregation:**
- Data is grouped by day (`DATE(ts)`)
- `energy_wh` is calculated as `MAX(energy_wh) - MIN(energy_wh)` per day
- `battery_pct` is the average for the day
- `device_name` is the last device name seen that day
- `session_min` is the session duration in minutes

---

### Telemetry Query

**GET** `/api/telemetry?from=2025-12-01T00:00:00Z&to=2025-12-16T23:59:59Z&limit=5000`

Returns raw telemetry records for a time range.

**Query Parameters:**
- `from` (optional): ISO 8601 start date/time (default: 24 hours ago)
- `to` (optional): ISO 8601 end date/time (default: now)
- `limit` (optional): Max rows to return (default: 5000, max: 20000)

**Response:**
```json
{
  "ok": true,
  "from": "2025-12-01T00:00:00.000Z",
  "to": "2025-12-16T23:59:59.000Z",
  "count": 1500,
  "data": [
    {
      "id": 1,
      "ts": "2025-12-01T00:00:00.000Z",
      "device_name": "ESP32-Solar",
      "power_w": 45.2,
      ...
    },
    ...
  ]
}
```

---

## Telemetry Ingestion Service

The backend can automatically fetch telemetry from ESP32 devices and store it in the database.

### How It Works

1. On startup, if `INGEST_ENABLED !== "false"`, the backend starts an ingestion loop
2. Every `INGEST_INTERVAL_MS` milliseconds, it:
   - Fetches telemetry from `TUNNEL_BASE_URL/data`
   - Inserts the data into the `telemetry` table
3. Errors are logged but don't stop the loop (with 2-second backoff)

### Configuration

**Enable Ingestion:**
```
TUNNEL_BASE_URL=https://your-tunnel.trycloudflare.com
INGEST_ENABLED=true
INGEST_INTERVAL_MS=10000
```

**Disable Ingestion:**
```
INGEST_ENABLED=false
```

### Requirements

- `TUNNEL_BASE_URL` must point to a Cloudflare tunnel URL that forwards to your ESP32 device
- ESP32 must be running and accessible via the tunnel
- ESP32 must have a `/data` endpoint that returns JSON telemetry

### Logs

Successful ingestion:
```
Ingest loop starting: every 10000ms
```

Errors:
```
Ingest tick failed: Tunnel fetch failed: 500 Internal Server Error
```

---

## Troubleshooting

### Backend Won't Start

**Problem:** Backend exits immediately after deployment

**Check:**
1. View backend logs in Railway
2. Look for: `Schema initialization failed` or `Missing required env var`

**Solutions:**
- Ensure MySQL service is connected and variables are referenced
- Verify all required MySQL environment variables are present
- Check MySQL service is running and accessible

---

### Database Connection Errors

**Problem:** `Error: Missing required env var: MYSQL_HOST`

**Solution:**
1. Go to backend service → **"Variables"** tab
2. Ensure MySQL service is referenced (should show as "Referenced from MySQL service")
3. If not, add reference: **"New Variable"** → **"Reference"** → Select MySQL service

---

### Schema Creation Fails

**Problem:** `Failed to initialize schema: ...`

**Check:**
1. Verify MySQL user has `CREATE TABLE` permissions
2. Check MySQL logs for specific error
3. Verify database name is correct

**Solution:**
- Railway MySQL users have full permissions by default
- If issue persists, check MySQL service logs

---

### No Telemetry Data

**Problem:** `/api/latest` returns `null` or `/api/telemetry` returns empty array

**Check:**
1. Is ingestion enabled? (`INGEST_ENABLED !== "false"`)
2. Is `TUNNEL_BASE_URL` set correctly?
3. Check backend logs for ingestion errors
4. Verify ESP32 is accessible via tunnel

**Solutions:**
- Ensure `TUNNEL_BASE_URL` is set and points to your ESP32
- Check ESP32 is online and responding to `/data` endpoint
- Verify Cloudflare tunnel is running and forwarding correctly

---

### npm Warning: "Use `--omit=dev` instead"

**Problem:** See warning in Railway logs: `npm warn config production Use '--omit=dev' instead.`

**Explanation:**
This is a harmless deprecation warning from npm. Railway uses the old `--production` flag internally.

**Solution:**
- This warning can be safely ignored
- It doesn't affect functionality
- Railway may update their build process in the future

---

### CORS Errors

**Problem:** Frontend can't access backend API endpoints

**Check:**
- Backend CORS headers are set to `Access-Control-Allow-Origin: *`
- Verify backend URL is correct in frontend configuration

**Solution:**
- Backend already allows all origins (`*`)
- If issues persist, check Railway service URL is correct

---

## Local Development

### Prerequisites

- Node.js 18+
- MySQL database (local or remote)
- npm or yarn

### Setup

1. **Install Dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Set Environment Variables:**
   
   Create a `.env` file in `backend/` directory:
   ```env
   MYSQL_HOST=localhost
   MYSQL_PORT=3306
   MYSQL_USER=root
   MYSQL_PASSWORD=yourpassword
   MYSQL_DATABASE=idast_telemetry
   
   # Optional
   PORT=3000
   TUNNEL_BASE_URL=https://your-tunnel.trycloudflare.com
   INGEST_ENABLED=true
   INGEST_INTERVAL_MS=10000
   ```

3. **Run Development Server:**
   ```bash
   npm run dev
   ```
   
   This uses `node --watch` for auto-reload on file changes.

4. **Run Production Server:**
   ```bash
   npm start
   ```

### Testing Endpoints

**Health Check:**
```bash
curl http://localhost:3000/health
```

**Latest Telemetry:**
```bash
curl http://localhost:3000/api/latest
```

**History CSV:**
```bash
curl http://localhost:3000/api/history.csv?days=30
```

**Telemetry Query:**
```bash
curl "http://localhost:3000/api/telemetry?from=2025-12-01T00:00:00Z&to=2025-12-16T23:59:59Z&limit=100"
```

### Database Setup (Local)

If using a local MySQL database, you can manually run the schema:

```bash
mysql -u root -p idast_telemetry < backend/schema.sql
```

**Note:** This is optional since the backend auto-creates tables on startup.

---

## Summary

### Quick Deployment Checklist

- [ ] MySQL service created and running in Railway
- [ ] Backend service created and connected to GitHub repo
- [ ] MySQL service referenced in backend variables
- [ ] Optional: `TUNNEL_BASE_URL` set if using ingestion
- [ ] Optional: `INGEST_ENABLED` and `INGEST_INTERVAL_MS` configured
- [ ] Backend deployed and logs show "Database schema initialized"
- [ ] Health check endpoint returns `{"ok": true}`
- [ ] Backend URL accessible from frontend

### Key Points

1. **No Manual SQL Required**: Schema is created automatically on startup
2. **Railway Handles Connections**: MySQL variables are automatically injected when services are connected
3. **Ingestion is Optional**: Set `INGEST_ENABLED=false` to disable automatic telemetry fetching
4. **CORS Enabled**: Backend allows all origins by default
5. **Error Handling**: Backend exits on schema failure but continues on ingestion errors

---

*Last Updated: December 2025*

