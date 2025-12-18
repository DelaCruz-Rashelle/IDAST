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

Real-time telemetry data is received via MQTT WebSocket subscription and displayed in the dashboard.

### Location: `pages/dashboard.js`

### MQTT Subscription

**Function:** MQTT client subscription via `useEffect` hook  
**Location:** Lines ~50-150 (MQTT connection setup)

```javascript
useEffect(() => {
  if (!MQTT_BROKER_URL) {
    setError("MQTT broker URL not configured");
    return;
  }

  const client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
  });

  client.on("connect", () => {
    console.log("✅ MQTT connected");
    client.subscribe("solar-tracker/+/telemetry");
    client.subscribe("solar-tracker/+/status");
  });

  client.on("message", (topic, message) => {
    const json = JSON.parse(message.toString());
    setData(json);
    // ... update state variables
  });

  return () => {
    client.end();
  };
}, []);
```

**MQTT Topics:**
- `solar-tracker/+/telemetry` - Real-time telemetry data (QoS 1)
- `solar-tracker/+/status` - Device status updates (QoS 1)

**Message Format:** JSON

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

**ESP32 Code Location:** `docs/arduino/arduino_receiver.md`

The ESP32 receiver:
1. Receives telemetry via ESP-NOW from the transmitter ESP32
2. Publishes telemetry to MQTT topic: `solar-tracker/{device_id}/telemetry`
3. Message includes all telemetry fields:
   - Sensor readings (top, left, right, avg)
   - Tracking data (tiltAngle, panAngle, errors)
   - Power and energy metrics
   - Battery status
   - Device information

**MQTT Publishing:** `publishTelemetry()` function in ESP32 receiver code

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

### MQTT-Based Communication

```
ESP32 Transmitter
    ↓ ESP-NOW
ESP32 Receiver
    ↓ MQTT Publish
EMQX Cloud (MQTT Broker)
    ↓ MQTT Subscribe
    ├─→ Frontend Dashboard (MQTT WebSocket)
    │   └─→ Real-time display
    └─→ Backend API (MQTT client)
        └─→ MySQL Database (persistent storage)
```

### Frontend Data Flow

**Location:** `pages/dashboard.js`

1. **Real-time Telemetry:**
   - MQTT WebSocket connection to EMQX Cloud
   - Subscribes to: `solar-tracker/+/telemetry`
   - Receives JSON messages every ~350ms
   - Updates dashboard state in real-time

2. **History Data:**
   - Fetched from backend API: `GET /api/history.csv`
   - Backend queries MySQL database
   - Returns CSV format for frontend parsing

3. **Control Commands (if enabled):**
   - Publishes to MQTT topic: `solar-tracker/{device_id}/control`
   - ESP32 subscribes and processes commands

### Backend Data Flow

**Location:** `backend/src/ingest.js`

1. **MQTT Subscription:**
   - Connects to EMQX Cloud MQTT broker
   - Subscribes to: `solar-tracker/+/telemetry`
   - Subscribes to: `solar-tracker/+/status`

2. **Data Storage:**
   - Receives telemetry messages
   - Parses JSON data
   - Inserts into MySQL `telemetry` table

3. **API Endpoints:**
   - `GET /api/latest` - Returns latest telemetry from database
   - `GET /api/history.csv` - Returns historical data as CSV
   - `GET /api/telemetry` - Returns raw telemetry records

### ESP32 Data Flow

**Location:** `docs/arduino/arduino_receiver.md`

1. **ESP-NOW Reception:**
   - Receives telemetry packets from transmitter ESP32
   - Updates `latestTelemetry` structure

2. **MQTT Publishing:**
   - Publishes to: `solar-tracker/{device_id}/telemetry` (every 350ms)
   - Publishes to: `solar-tracker/{device_id}/status` (on connect/disconnect)
   - Uses QoS 1 for reliable delivery

3. **History Logging:**
   - Periodically logs to ESP32's internal storage
   - History data is also stored in backend MySQL database

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

- `data`: Current telemetry JSON from MQTT messages
- `historyData`: CSV string from backend `/api/history.csv` endpoint
- `gridPrice`: Grid price in cents/kWh (from telemetry or user input)
- `totalEnergyKWh`: Calculated from `historyData`

### Update Intervals

**MQTT Real-time Updates:**
- **Telemetry Data:** Received via MQTT every ~350ms (push-based, no polling)
- **Status Updates:** Received via MQTT on device connect/disconnect

**Polling (for history only):**
- **History Data:** Fetched from backend API every 30 seconds
- **Backend API:** Queries MySQL database for historical data

---

## Summary

| Data Point | Frontend Location | Backend Location | Data Source |
|------------|-------------------|------------------|-------------|
| **Total Energy** | `dashboard.js` | Backend `/api/history.csv` | MySQL database |
| **Average per Day** | `dashboard.js` | Calculated from Total Energy | Derived metric |
| **Estimated Savings** | `dashboard.js` | Calculated from Total Energy × Grid Price | Derived metric |
| **Most Active Device** | `dashboard.js` | Backend `/api/history.csv` | MySQL database |
| **Realtime Telemetry** | `dashboard.js` (MQTT) | ESP32 → MQTT → EMQX Cloud | Live sensor data via MQTT |
| **Energy Harvested** | `dashboard.js` | Same as Total Energy | MySQL database |

---

## Notes

- **MQTT-Based Architecture**: All real-time telemetry uses MQTT pub/sub (no HTTP polling)
- **Push-Based Updates**: Telemetry is pushed from ESP32 via MQTT (every ~350ms)
- **Backend Storage**: Backend subscribes to MQTT and stores all telemetry in MySQL
- **History Data**: Fetched from backend MySQL database (not from ESP32)
- **No Tunneling Required**: ESP32 connects directly to EMQX Cloud MQTT broker
- **No USB Required**: ESP32 runs independently after initial WiFi configuration
- **Calculations**: Performed client-side in the React component
- **Real-time Updates**: Automatic via MQTT WebSocket (no polling needed)

