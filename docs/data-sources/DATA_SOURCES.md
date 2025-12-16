# Data Sources Documentation

This document explains where the code is located for all data displayed in the Solar Tracker Dashboard, including the Monthly Report — Energy History section, Realtime Tracker Telemetry, and Energy Harvested metrics.

## Table of Contents

1. [Monthly Report — Energy History](#monthly-report--energy-history)
2. [Realtime Tracker Telemetry](#realtime-tracker-telemetry)
3. [Energy Harvested](#energy-harvested)
4. [Data Flow Architecture](#data-flow-architecture)

---

## Monthly Report — Energy History

The Monthly Report section displays energy statistics calculated from historical CSV data. All calculations are performed in the frontend React component.

### Location: `pages/dashboard.js`

### 1. Total Energy

**Display Location:** Lines 1252-1255  
**Calculation Location:** Lines 523-532

```javascript
const totalEnergyKWh = historyData
  ? historyData
      .trim()
      .split("\n")
      .slice(1)
      .reduce((acc, line) => {
        const parts = line.split(",");
        return acc + (parseFloat(parts[1]) || 0) / 1000.0;
      }, 0)
  : 0;
```

**How it works:**
- Reads CSV data from `historyData` state variable
- Parses each line (skipping header)
- Extracts energy value (column 1, in Wh)
- Converts to kWh by dividing by 1000
- Sums all values to get total energy

**Data Source:** CSV file served by ESP32 at `/api/history` endpoint

---

### 2. Average per Day

**Display Location:** Lines 1256-1264  
**Calculation Location:** Lines 1259-1261

```javascript
{historyData
  ? (totalEnergyKWh / Math.max(historyData.trim().split("\n").slice(1).length, 1)).toFixed(3)
  : "0.000"}{" "}
kWh
```

**How it works:**
- Divides `totalEnergyKWh` by the number of data points (days) in the history
- Uses `Math.max(..., 1)` to prevent division by zero
- Rounds to 3 decimal places

**Data Source:** Calculated from `totalEnergyKWh` and `historyData` length

---

### 3. Estimated Savings

**Display Location:** Lines 1265-1268  
**Calculation Location:** Line 1267

```javascript
₱{(totalEnergyKWh * parseFloat(gridPrice || 12)).toFixed(2)}
```

**How it works:**
- Multiplies total energy (kWh) by grid price (cents/kWh)
- Uses `gridPrice` state variable (defaults to 12.00 if not set)
- Formats as Philippine Peso (₱) with 2 decimal places

**Data Source:** 
- `totalEnergyKWh` (calculated from history CSV)
- `gridPrice` state variable (from ESP32 telemetry or user input)

---

### 4. Most Active Device

**Display Location:** Lines 1269-1293  
**Calculation Location:** Lines 1272-1290

```javascript
{historyData
  ? (() => {
      const lines = historyData.trim().split("\n").slice(1);
      const deviceEnergy = {};
      lines.forEach((line) => {
        const parts = line.split(",");
        if (parts.length >= 4) {
          const device = parts[3] || "Unknown";
          const energy = parseFloat(parts[1]) || 0;
          deviceEnergy[device] = (deviceEnergy[device] || 0) + energy;
        }
      });
      const entries = Object.entries(deviceEnergy);
      if (entries.length === 0) return "—";
      const mostActive = entries.reduce((max, [device, energy]) =>
        energy > max[1] ? [device, energy] : max
      );
      return mostActive[0] !== "Unknown" ? mostActive[0] : "—";
    })()
  : "—"}
```

**How it works:**
- Parses CSV history data
- Groups energy values by device name (column 4 in CSV)
- Sums energy for each device
- Finds device with highest total energy
- Returns device name or "—" if no valid device found

**Data Source:** CSV file served by ESP32 at `/api/history` endpoint

---

## Realtime Tracker Telemetry

Real-time telemetry data is fetched from the ESP32 device and displayed in the dashboard.

### Location: `pages/dashboard.js`

### Data Fetching Function

**Function:** `fetchData()`  
**Location:** Lines 107-241

```javascript
const fetchData = async () => {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    setError("API URL not configured...");
    return;
  }
  try {
    const fetchUrl = apiUrl.includes('/api/') 
      ? `${apiUrl}/data` 
      : `${apiUrl}/data`;
    
    const res = await fetch(fetchUrl);
    if (res.ok) {
      const json = await res.json();
      setData(json);
      // ... update state variables
    }
  } catch (e) {
    // ... error handling
  }
};
```

**API Endpoint:** `/data` (GET request)  
**Response Format:** JSON

### Display Location: Lines 907-1002

The telemetry data is displayed in the "Realtime Tracker Telemetry" card section:

- **Panel Power** (Line 914): `data?.powerW`
- **Energy** (Line 920): `data?.energyKWh`
- **Phones Charged** (Line 926): `data?.phones`
- **Phone Use** (Line 932): `data?.phoneMinutes`
- **₱ Saved** (Line 938): `data?.pesos`
- **Battery** (Line 944): `data?.batteryPct`
- **Battery V** (Line 952): `data?.batteryV`
- **Efficiency** (Line 958): `data?.efficiency`
- **Panel Temp** (Line 964): `data?.tempC`
- **State** (Line 970): `data?.steady ? "Locked" : "Tracking"`

### Backend Data Source

**ESP32 Code Location:** `arduino.md` (lines 313-398)

The ESP32's `sendTelemetryJson()` function constructs the JSON response with all telemetry fields:
- Sensor readings (top, left, right, avg)
- Tracking data (tiltAngle, panAngle, errors)
- Power and energy metrics
- Battery status
- Device information

**API Route Handler:** `handle_data()` function in ESP32 code (line 401-403)

---

## Energy Harvested

The "Energy Harvested" metric is displayed in the status card at the top of the dashboard.

### Location: `pages/dashboard.js`

### Display Location: Lines 897-903

```javascript
<div className="status-card">
  <div className="label">Energy Harvested</div>
  <div className="value">
    <span className="peso">{totalEnergyKWh.toFixed(3)} kWh</span>
  </div>
  <div className="sub">Cumulative energy delivered to connected devices</div>
  <div className="trend">Goal: 0.150 kWh by end of month</div>
</div>
```

### Calculation

**Uses the same `totalEnergyKWh` variable** as the Monthly Report (Lines 523-532)

**Data Source:** CSV history data from `/api/history` endpoint

---

## Data Flow Architecture

### Frontend to Backend Communication

```
Dashboard (pages/dashboard.js)
    ↓
getApiUrl() → Determines API endpoint
    ↓
fetchData() → GET /data → ESP32 /data endpoint
loadHistory() → GET /api/history → ESP32 /api/history endpoint
sendControl() → POST /control → ESP32 /control endpoint
```

### API Proxy Layer

**Location:** `pages/api/tunnel-proxy.js`

When using Cloudflare tunnel, requests are proxied through Next.js API routes to avoid CORS issues:

```
Frontend → /api/tunnel-proxy?endpoint=/data → Cloudflare Tunnel → ESP32
```

### ESP32 Endpoints

**Location:** `arduino.md`

1. **`/data` endpoint** (Line 401-403)
   - Handler: `handle_data()`
   - Function: `sendTelemetryJson()` (Lines 313-398)
   - Returns: JSON telemetry packet

2. **`/api/history` endpoint** (Lines 450-459)
   - Handler: `handle_history()`
   - Returns: CSV file from LittleFS (`/history.csv`)
   - Format: `timestamp,energy_wh,battery_pct,device_name,session_min`

3. **`/control` endpoint** (Lines 405-448)
   - Handler: `handle_control()`
   - Accepts: POST requests with form-urlencoded data
   - Processes: Control commands (mode, tilt, pan, price, deviceName)

### Data Storage

**History Data Storage:**
- **Location:** ESP32 LittleFS filesystem
- **File:** `/history.csv`
- **Format:** CSV with columns: timestamp, energy_wh, battery_pct, device_name, session_min
- **Seeding:** `seed_placeholder_history()` function (Lines 281-301) creates initial placeholder data

**History Logging:**
- **Function:** `log_history_point()` (referenced at line 110)
- **Trigger:** Called periodically when telemetry is received (Line 126)
- **Interval:** `HISTORY_INTERVAL_MS` (defined in ESP32 code)

### State Management

**Frontend State Variables** (in `pages/dashboard.js`):

- `data` (Line 10): Current telemetry JSON from `/data` endpoint
- `historyData` (Line 11): CSV string from `/api/history` endpoint
- `gridPrice` (Line 16): Grid price in cents/kWh
- `totalEnergyKWh` (Lines 523-532): Calculated from `historyData`

### Update Intervals

**Location:** Lines 420-433

```javascript
useEffect(() => {
  if (typeof window !== "undefined" && sessionStorage.getItem("isAuthenticated")) {
    fetchData();
    loadHistory();
    const dataInterval = setInterval(fetchData, 350);      // Every 350ms
    const historyInterval = setInterval(loadHistory, 30000); // Every 30 seconds
    return () => {
      clearInterval(dataInterval);
      clearInterval(historyInterval);
    };
  }
}, []);
```

- **Telemetry Data:** Fetched every 350ms (0.35 seconds)
- **History Data:** Fetched every 30 seconds

---

## Summary

| Data Point | Frontend Location | Backend Location | Data Source |
|------------|-------------------|------------------|-------------|
| **Total Energy** | `dashboard.js:523-532` | ESP32 `/api/history` | CSV history file |
| **Average per Day** | `dashboard.js:1259-1261` | Calculated from Total Energy | Derived metric |
| **Estimated Savings** | `dashboard.js:1267` | Calculated from Total Energy × Grid Price | Derived metric |
| **Most Active Device** | `dashboard.js:1272-1290` | ESP32 `/api/history` | CSV history file |
| **Realtime Telemetry** | `dashboard.js:107-241, 907-1002` | ESP32 `/data` | Live sensor data |
| **Energy Harvested** | `dashboard.js:897-903` | Same as Total Energy | CSV history file |

---

## Notes

- All calculations are performed client-side in the React component
- History data is stored on the ESP32 device in LittleFS filesystem
- Real-time telemetry is fetched frequently (350ms) for live updates
- History data is fetched less frequently (30s) to reduce load
- The dashboard supports multiple connection modes: AP Mode, Proxy Mode, and Tunnel Mode

