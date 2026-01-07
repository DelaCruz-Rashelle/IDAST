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
- Automatically ingests telemetry from ESP32 devices via MQTT (EMQX Cloud)
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
3. **EMQX Cloud Account**: Sign up at [emqx.com](https://www.emqx.com/en/cloud) for MQTT broker
4. **MQTT Broker Credentials**: Username and password for EMQX Cloud deployment
5. **Node.js 18+**: Required for local development/testing

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
Database schema initialized (device_registration and grid_price tables ready)
MQTT ingest starting...
Connecting to MQTT broker: mqtts://your-broker.emqx.cloud:8883
✅ MQTT client connected
✅ Subscribed to: solar-tracker/+/telemetry
✅ Subscribed to: solar-tracker/+/status
Listening on port 8080
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
| `MQTT_BROKER_URL` | MQTT broker URL (required for ingestion) | Required if `INGEST_ENABLED=true` |
| `MQTT_USERNAME` | MQTT broker username | Optional (if broker requires auth) |
| `MQTT_PASSWORD` | MQTT broker password | Optional (if broker requires auth) |
| `INGEST_ENABLED` | Enable MQTT telemetry ingestion | `true` |
| `DATABASE_URL` | Alternative MySQL connection string | Uses individual MySQL vars if not set |

### Setting Optional Variables

1. Go to your backend service → **"Variables"** tab
2. Click **"New Variable"**
3. Add variables as needed:

**Example: Enable MQTT Ingestion**
```
MQTT_BROKER_URL=mqtts://your-deployment-id.emqx.cloud:8883
MQTT_USERNAME=solar-tracker
MQTT_PASSWORD=your-password
INGEST_ENABLED=true
```

**Example: Disable Ingestion**
```
INGEST_ENABLED=false
```

**Note:** For EMQX Cloud, use:
- Protocol: `mqtts://` (MQTT over TLS)
- Port: `8883` (TLS port)
- No `/mqtt` suffix needed for backend

---

## Automatic Schema Initialization

The backend **automatically creates the database schema** when it starts. You do **not** need to manually run SQL scripts.

### How It Works

1. On startup, the backend calls `initSchema()` from `backend/src/db.js`
2. This function creates the following tables if they don't exist:
   - `device_registration` - Stores registered device names
   - `grid_price` - Stores grid price values and estimated savings
3. Uses `CREATE TABLE IF NOT EXISTS`, so it's safe to run multiple times
4. If schema creation fails, the backend exits with an error

### Schema Details

**Table: `device_registration`**
- **Primary Key**: `id` (auto-incrementing BIGINT)
- **Device Name**: `device_name` (VARCHAR(64), UNIQUE)
- **Timestamps**: `created_at`, `updated_at` (TIMESTAMP(3) with millisecond precision)
- **Index**: `idx_device_name` on `device_name` column

**Table: `grid_price`**
- **Primary Key**: `id` (auto-incrementing BIGINT)
- **Price**: `price` (DECIMAL(10,2)) - Grid price in cents/kWh
- **Estimated Savings**: `estimated_savings` (DECIMAL(12,2)) - Calculated savings in pesos
- **Timestamps**: `created_at`, `updated_at` (TIMESTAMP(3) with millisecond precision)
- **Index**: `idx_updated_at` on `updated_at` column

**Note:** The `device_state` table has been removed. Energy and battery data are not stored in the database - they come from CSV history files or MQTT telemetry (real-time only).

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

### Latest Device

**GET** `/api/latest`

Returns the most recently updated device registration.

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": 123,
    "device_name": "iPhone 15",
    "created_at": "2025-12-16T22:30:00.000Z",
    "updated_at": "2025-12-16T22:30:00.000Z"
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

Returns empty CSV since `device_state` table has been removed. Historical data is now only available from ESP32 CSV files.

**Query Parameters:**
- `days` (optional): Number of days to retrieve (default: 60, max: 365)

**Response Format:**
```csv
timestamp,energy_wh,battery_pct,device_name,session_min
```

**Note:** This endpoint returns an empty CSV with headers only. Historical energy data is not stored in the database - it comes from ESP32 CSV history files.

---

### Telemetry Query

**GET** `/api/telemetry?from=2025-12-01T00:00:00Z&to=2025-12-16T23:59:59Z&limit=5000`

Returns empty data since `device_state` table has been removed.

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
  "count": 0,
  "data": []
}
```

**Note:** This endpoint returns empty data. Telemetry data is not stored in the database - it's only available via MQTT in real-time.
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

The backend automatically subscribes to MQTT topics and registers devices in the database.

### How It Works

1. On startup, if `INGEST_ENABLED !== "false"`, the backend connects to the MQTT broker
2. Subscribes to topics:
   - `solar-tracker/+/telemetry` - Real-time telemetry data
   - `solar-tracker/+/status` - Device status updates
3. When messages are received:
   - Parses JSON telemetry data
   - Extracts `deviceName` from telemetry
   - Registers device in `device_registration` table (creates if doesn't exist, updates `updated_at` if exists)
   - Note: Energy and battery data are NOT stored in database (only device registration)
4. Errors are logged but don't stop the MQTT connection (automatic reconnection)

### Configuration

**Enable MQTT Ingestion:**
```
MQTT_BROKER_URL=mqtts://your-deployment-id.emqx.cloud:8883
MQTT_USERNAME=solar-tracker
MQTT_PASSWORD=your-password
INGEST_ENABLED=true
```

**Disable Ingestion:**
```
INGEST_ENABLED=false
```

### Requirements

- `MQTT_BROKER_URL` must point to your EMQX Cloud deployment (or other MQTT broker)
- ESP32 devices must be publishing to `solar-tracker/{device_id}/telemetry` topic
- MQTT broker must be accessible from Railway (internet connection required)
- If broker requires authentication, set `MQTT_USERNAME` and `MQTT_PASSWORD`

### Logs

Successful connection:
```
MQTT ingest starting...
Connecting to MQTT broker: mqtts://your-broker.emqx.cloud:8883
✅ MQTT client connected
✅ Subscribed to: solar-tracker/+/telemetry
✅ Subscribed to: solar-tracker/+/status
✅ Device registered from telemetry: esp32-receiver-08D1F9
```

Errors:
```
MQTT connection failed: Connection refused
MQTT reconnect attempt in 5 seconds...
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

### No Device Registration

**Problem:** `/api/latest` returns `null` or `/api/devices` returns empty array

**Note:** `/api/telemetry` and `/api/history.csv` return empty data by design (device_state table removed)

**Check:**
1. Is ingestion enabled? (`INGEST_ENABLED !== "false"`)
2. Is `MQTT_BROKER_URL` set correctly?
3. Check backend logs for MQTT connection status
4. Verify ESP32 is publishing to MQTT topics with `deviceName` field
5. Check EMQX Cloud dashboard for active connections

**Solutions:**
- Ensure `MQTT_BROKER_URL` is set and points to your EMQX Cloud deployment
- Verify `MQTT_USERNAME` and `MQTT_PASSWORD` are correct (if required)
- Check ESP32 is connected to WiFi and publishing to MQTT
- Verify MQTT broker is accessible from Railway
- Check EMQX Cloud dashboard → Clients to see if backend is connected
- Ensure ESP32 telemetry includes `deviceName` field (not "Unknown")

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
   PORT=8080
   MQTT_BROKER_URL=mqtts://your-deployment-id.emqx.cloud:8883
   MQTT_USERNAME=solar-tracker
   MQTT_PASSWORD=your-password
   INGEST_ENABLED=true
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
- [ ] `MQTT_BROKER_URL` set (required for ingestion)
- [ ] `MQTT_USERNAME` and `MQTT_PASSWORD` set (if broker requires auth)
- [ ] Optional: `INGEST_ENABLED` configured (defaults to `true`)
- [ ] Backend deployed and logs show "Database schema initialized"
- [ ] Backend logs show "✅ MQTT client connected"
- [ ] Health check endpoint returns `{"ok": true}`
- [ ] Backend URL accessible from frontend

### Key Points

1. **No Manual SQL Required**: Schema is created automatically on startup
2. **Railway Handles Connections**: MySQL variables are automatically injected when services are connected
3. **MQTT-Based Ingestion**: Backend subscribes to MQTT topics for real-time telemetry
4. **No Tunneling Required**: ESP32 connects directly to MQTT broker, backend subscribes
5. **Automatic Reconnection**: MQTT client automatically reconnects on connection loss
6. **CORS Enabled**: Backend allows all origins by default
7. **Error Handling**: Backend exits on schema failure but continues on MQTT errors

---

*Last Updated: December 2025*

