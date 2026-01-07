# Panel Questions - Simple Answers

This document answers common questions about how the Solar Tracker system works in easy-to-understand terms.

---

## 1. If the BATELEC grid price is changed, where does it come from and where is it saved?

### Where the Price Comes From

The grid price comes from **user input only**:

1. **User types it in the dashboard**
   - There's an input field on the dashboard where users can enter the price
   - **No default value** - the field starts empty
   - The price must be between 0 and 1000 cents/kWh
   - User must click the **"Save" button** to save the price

**Important:** The grid price is **NOT** automatically updated from ESP32 telemetry. Users must manually enter and save the price.

### How It Gets Saved

**Simple explanation:**
1. User types a new price in the dashboard input field
2. User clicks the **"Save" button**
3. Dashboard saves the price to the **database** (MySQL `grid_price` table)
4. Dashboard also sends the price via MQTT to the ESP32 (if control commands are enabled)
5. The price stays saved in the database permanently
6. When the dashboard loads, it retrieves the saved price from the database

### Where It's Saved

**Primary Location:** MySQL database on the backend server (Railway)

- Stored in the `grid_price` table
- Saved permanently in the cloud database
- Persists across browser sessions and device restarts
- Each save creates a new record with a timestamp

**Secondary Location:** ESP32 device (if MQTT control is enabled)

- Also sent to ESP32 via MQTT control commands
- Saved in ESP32's permanent memory (Preferences)
- Used by ESP32 for calculations

**In simple terms:** The price is saved in the cloud database first, and also sent to the ESP32 device. The database is the primary storage location, ensuring the price persists even if the ESP32 is reset.

---

## 2. Where is the API/History located?

### Simple Answer

The history data comes from **ESP32 CSV files** stored on the device itself. The backend API endpoint `/api/history.csv` currently returns empty data since the `device_state` table has been removed.

### Where It Lives

**On the ESP32 Device:**
- History data is stored in a CSV file (`/history.csv`) on the ESP32's internal storage (LittleFS)
- The ESP32 logs energy data periodically to this file
- The file is served via the ESP32's web server at `/api/history` endpoint

**On the Backend Server (Railway):**
- The backend API endpoint `/api/history.csv` exists but returns empty CSV (device_state table removed)
- Historical energy data is NOT stored in the database
- Only device registration and grid prices are stored in the database

**In the dashboard code:**
- The dashboard can fetch history data from ESP32 CSV files (if ESP32 is accessible)
- Or from backend API (which currently returns empty data)

### How It Works

**Think of it like this:**
- ESP32 logs energy data to CSV file on device storage
- ESP32 serves CSV file via web server
- Dashboard can fetch from ESP32 directly (if accessible) or from backend API (currently empty)

**Data Flow:**
1. **ESP32** logs energy data to CSV file periodically
2. **ESP32** serves CSV file via `/api/history` endpoint
3. **Dashboard** can fetch history from ESP32 or backend API

**In simple terms:** History data is stored on the ESP32 device in a CSV file. The backend database does not store historical energy data - only device registration and grid prices.

---

## 3. Where is the content of the API? And where does the API come from?

### Simple Answer

The system uses **MQTT (Message Queuing Telemetry Transport)** for real-time data and **REST API** for historical data. All real-time data comes from the ESP32 device via MQTT, and historical data comes from the backend database.

### The Data Sources Explained

#### 1. Real-Time Telemetry (MQTT)

**What it contains:**
- Current power output
- Battery level and voltage
- Panel temperature
- Servo positions (tilt and pan angles)
- Grid price
- Device name
- WiFi information
- And other live sensor readings

**Where it comes from:**
- The ESP32 transmitter reads all its sensors in real-time
- Sends data via ESP-NOW to ESP32 receiver
- ESP32 receiver publishes to MQTT topic: `solar-tracker/{device_id}/telemetry`
- Dashboard subscribes to MQTT and receives updates automatically (every ~350ms)
- **No HTTP polling needed** - data is pushed via MQTT

**Think of it like:** A live TV broadcast - data is sent continuously, and you receive it automatically

#### 2. Historical Data (ESP32 CSV Files)

**What it contains:**
- A CSV file (like an Excel spreadsheet) with all past energy data
- Each row has: timestamp, energy used, battery level, device name, and session time

**Where it comes from:**
- ESP32 logs energy data to CSV file on device storage (LittleFS)
- ESP32 serves CSV file via `/api/history` endpoint
- Backend API `/api/history.csv` returns empty data (device_state table removed)
- Dashboard can fetch from ESP32 directly or from backend API

**Think of it like:** A local file on the ESP32 device that contains the history log

#### 3. Control Commands (MQTT - if enabled)

**What it does:**
- Lets you send commands to the ESP32 via MQTT
- You can change settings like:
  - Switch between auto and manual mode
  - Adjust tilt and pan angles
  - Update the grid price
  - Set device name

**Where it comes from:**
- You send commands from the dashboard
- Dashboard publishes to MQTT topic: `solar-tracker/{device_id}/control`
- ESP32 subscribes and receives commands

**Think of it like:** Sending a text message - you send it, and the ESP32 receives it

### How the System Connects

**MQTT-Based Architecture:**
1. **ESP32** connects to WiFi and publishes to EMQX Cloud MQTT broker
2. **Frontend** connects via MQTT WebSocket to EMQX Cloud
3. **Backend** connects via MQTT client to EMQX Cloud
4. **No tunneling or direct HTTP access needed** - everything goes through MQTT broker

**In simple terms:** All real-time data comes from the ESP32 via MQTT. Historical data comes from the backend database. The MQTT broker (EMQX Cloud) acts as a central message hub.

---

## 4. Where is the data being saved?

### Simple Answer

Different types of data are saved in different places. Most important data is saved on the ESP32 device itself.

### Where Each Type of Data is Saved

#### 1. History Data (Energy Logs) - DEVICE STORAGE

**Location:** On the ESP32 device in CSV file (`/history.csv`)

- This is like a spreadsheet stored on the ESP32's internal storage (LittleFS)
- Each row records: when it happened, how much energy was used, battery level, device name, and session time
- The ESP32 logs energy data periodically to this CSV file
- **Important:** This data is stored on the ESP32 device, not in the cloud database
- **Note:** Historical energy data is NOT stored in the backend database (device_state table removed)

**Think of it like:** A local log file on the ESP32 device that records energy history

#### 2. Grid Price - PERMANENT STORAGE

**Location:** MySQL database on the backend server (Railway) - `grid_price` table

- Saved in the cloud database permanently
- User must enter the price in the dashboard and click "Save"
- No default value - field starts empty
- When you change the price, it's saved to the database
- When the dashboard loads, it retrieves the saved price from the database
- **Important:** This stays saved in the cloud even if ESP32 is reset
- Also sent to ESP32 via MQTT (if control commands enabled) for device-side calculations

**Think of it like:** A cloud-based setting that persists across all devices and sessions

#### 3. Real-Time Telemetry Data - REAL-TIME ONLY

**Location:** Received via MQTT and displayed on dashboard (NOT saved to database)

- This is the live data you see updating on the screen
- **NOT saved:** Backend does NOT store telemetry data in database (device_state table removed)
- **Device Registration:** Backend only registers devices in `device_registration` table when telemetry is received
- Data is received via MQTT (push-based, no polling)
- The dashboard receives updates every ~350ms automatically via MQTT
- Historical data is available from ESP32 CSV files, not from database

**Think of it like:** A live TV feed that's displayed but not recorded in the cloud database

#### 4. Dashboard Settings - SEMI-PERMANENT

**Location:** In your web browser's storage (if any)

- MQTT connection settings are configured via environment variables (Vercel)
- No local browser storage needed for connection settings
- Settings are managed server-side

**Think of it like:** Server-side configuration - managed by the deployment platform

### Important Points to Remember

1. **History data is stored on ESP32 device** - in CSV file on device storage (not in cloud database)
2. **Grid price is stored in the cloud database** - primary storage location, survives power cycles
3. **Device registration is stored in the cloud database** - devices are registered when telemetry is received
4. **Real-time data is NOT saved to database** - only device registration is updated
5. **If ESP32 is reset** - grid price and device registration are safe in the cloud database, but history CSV may be lost
6. **No USB or tunneling needed** - ESP32 runs independently via MQTT

**In simple terms:** The ESP32 sends data via MQTT, the backend registers the device, and the dashboard displays real-time data. Grid price and device registration are safe in the cloud database. History data is stored on the ESP32 device in CSV files.

---

## Quick Summary

### 1. BATELEC Grid Price
- **Where it comes from:** User types it in the dashboard (no default value)
- **Where it's saved:** MySQL database (`grid_price` table) on backend server + ESP32 (if MQTT enabled)
- **How to save:** User must click "Save" button after entering price
- **Stays saved:** Yes, permanently in cloud database, even after power cycles

### 2. API/History Location
- **Where it is:** On ESP32 device at `/api/history` (CSV file) or backend server at `/api/history.csv` (returns empty)
- **What it does:** ESP32 serves CSV file with energy history data; Backend API returns empty CSV (device_state removed)
- **How often:** Dashboard can check periodically

### 3. Data Sources
- **Real-time telemetry:** Received via MQTT from ESP32 (updates every ~350ms automatically)
- **Historical data:** Fetched from ESP32 CSV files (not from backend database)
- **Control commands:** Sent via MQTT to ESP32 (if enabled)
- **Real-time data comes from:** ESP32 device via MQTT
- **Historical data comes from:** ESP32 CSV files on device storage

### 4. Data Storage
- **History data:** Stored on ESP32 device in CSV file (NOT in cloud database)
- **Grid price:** Saved permanently in MySQL database (`grid_price` table) on backend server (cloud)
- **Device registration:** Saved in MySQL database (`device_registration` table) on backend server (cloud)
- **Live data:** NOT saved to database - only device registration is updated
- **Dashboard settings:** Managed via environment variables (Vercel)

**Key Takeaway:** Real-time data comes from ESP32 via MQTT. Historical data is stored on ESP32 device in CSV files (not in cloud database). Grid price and device registration are safe in the cloud database. No USB or tunneling needed - everything works via MQTT.

---

*Document created for panel presentation - Easy-to-understand answers*