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

The history data is stored in the **MySQL database on the backend server** (Railway) and accessed through the backend API endpoint `/api/history.csv`.

### Where It Lives

**On the Backend Server (Railway):**
- The backend subscribes to MQTT topics and stores all telemetry data in a MySQL database
- When you ask for `/api/history.csv`, the backend queries the database and returns a CSV file
- The data is stored permanently in the cloud database

**In the dashboard code:**
- The dashboard fetches history data from the backend API
- It does this automatically every 30 seconds to keep the display updated

### How It Works

**Think of it like this:**
- ESP32 publishes telemetry via MQTT → Backend receives and stores in database
- Dashboard asks backend for history → Backend queries database → Returns CSV file
- No direct connection to ESP32 needed for history data

**Data Flow:**
1. **ESP32** publishes telemetry via MQTT (every 350ms)
2. **Backend** subscribes to MQTT and stores data in MySQL database
3. **Dashboard** fetches history from backend API every 30 seconds

**In simple terms:** The history is stored in the cloud database. The ESP32 sends data via MQTT, the backend saves it, and the dashboard displays it.

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

#### 2. Historical Data (Backend API)

**What it contains:**
- A CSV file (like an Excel spreadsheet) with all past energy data
- Each row has: timestamp, energy used, battery level, device name, and session time

**Where it comes from:**
- Backend subscribes to MQTT and stores all telemetry in MySQL database
- When you ask for `/api/history.csv`, the backend queries the database
- Returns CSV file with historical data
- Dashboard fetches from backend API every 30 seconds

**Think of it like:** A library database - you ask for records, and it gives you the stored information

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

#### 1. History Data (Energy Logs) - PERMANENT STORAGE

**Location:** In the MySQL database on the backend server (Railway)

- This is like a spreadsheet stored in the cloud database
- Each row records: when it happened, how much energy was used, battery level, device name, and session time
- The backend automatically stores telemetry data received via MQTT
- **Important:** This data stays saved permanently in the cloud database
- **Backup:** Data is stored in the cloud, so it's safe even if ESP32 is reset

**Think of it like:** A cloud-based diary that automatically saves everything

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

#### 3. Real-Time Telemetry Data - AUTOMATICALLY SAVED

**Location:** Received via MQTT and displayed on dashboard, **also saved to backend database**

- This is the live data you see updating on the screen
- **Also saved:** Backend automatically stores all telemetry in MySQL database
- Data is received via MQTT (push-based, no polling)
- The dashboard receives updates every ~350ms automatically via MQTT
- Historical data is available from the backend database

**Think of it like:** A live TV feed that's also being recorded automatically

#### 4. Dashboard Settings - SEMI-PERMANENT

**Location:** In your web browser's storage (if any)

- MQTT connection settings are configured via environment variables (Vercel)
- No local browser storage needed for connection settings
- Settings are managed server-side

**Think of it like:** Server-side configuration - managed by the deployment platform

### Important Points to Remember

1. **History data is stored in the cloud database** - safe and permanent
2. **Grid price is stored in the cloud database** - primary storage location, survives power cycles
3. **Device name is stored in the cloud database** - saved when user clicks "Start Charging"
4. **Real-time data is automatically saved** - backend stores all telemetry
5. **If ESP32 is reset** - history data, grid price, and device name are safe in the cloud database
6. **No USB or tunneling needed** - ESP32 runs independently via MQTT

**In simple terms:** The ESP32 sends data via MQTT, the backend saves it in the cloud, and the dashboard displays it. User settings (grid price, device name) and history data are all safe in the cloud database even if the ESP32 is reset.

---

## Quick Summary

### 1. BATELEC Grid Price
- **Where it comes from:** User types it in the dashboard (no default value)
- **Where it's saved:** MySQL database (`grid_price` table) on backend server + ESP32 (if MQTT enabled)
- **How to save:** User must click "Save" button after entering price
- **Stays saved:** Yes, permanently in cloud database, even after power cycles

### 2. API/History Location
- **Where it is:** On the backend server at `/api/history.csv`
- **What it does:** Returns a CSV file with all energy history data from MySQL database
- **How often:** Dashboard checks every 30 seconds

### 3. Data Sources
- **Real-time telemetry:** Received via MQTT from ESP32 (updates every ~350ms automatically)
- **Historical data:** Fetched from backend MySQL database via `/api/history.csv`
- **Control commands:** Sent via MQTT to ESP32 (if enabled)
- **Real-time data comes from:** ESP32 device via MQTT
- **Historical data comes from:** Backend MySQL database

### 4. Data Storage
- **History data:** Saved permanently in MySQL database on backend server (cloud)
- **Grid price:** Saved permanently in MySQL database (`grid_price` table) on backend server (cloud)
- **Device name:** Saved permanently in MySQL database (`device` table) on backend server (cloud)
- **Live data:** Automatically saved to backend database via MQTT
- **Dashboard settings:** Managed via environment variables (Vercel)

**Key Takeaway:** Real-time data comes from ESP32 via MQTT. Historical data is stored in the cloud database. Data is safe in the cloud even if ESP32 is reset. No USB or tunneling needed - everything works via MQTT.

---

*Document created for panel presentation - Easy-to-understand answers*