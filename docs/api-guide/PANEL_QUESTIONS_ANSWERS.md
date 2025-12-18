# Panel Questions - Simple Answers

This document answers common questions about how the Solar Tracker system works in easy-to-understand terms.

---

## 1. If the BATELEC grid price is changed, where does it come from and where is it saved?

### Where the Price Comes From

The grid price can come from two places:

1. **User types it in the dashboard**
   - There's an input field on the dashboard where users can enter the price
   - Default value is 12.00 cents/kWh
   - The price must be between 0 and 1000

2. **Received via MQTT from ESP32**
   - ESP32 publishes grid price in telemetry messages via MQTT
   - Dashboard receives it automatically when connected to MQTT
   - This makes sure the dashboard shows the correct price

### How It Gets Saved

**Simple explanation:**
1. User types a new price in the dashboard
2. Dashboard publishes the new price via MQTT to the ESP32 (if control commands are enabled)
3. The ESP32 receives it and saves it permanently in its memory
4. The price stays saved even if the ESP32 is turned off and back on

**Note:** In the current MQTT-based architecture, control commands may be disabled. Grid price is primarily set on the ESP32 device itself.

### Where It's Saved

**Location:** Inside the ESP32 device's permanent memory

- Think of it like saving a file on a computer - it's stored permanently
- The ESP32 has special memory that doesn't get erased when power is turned off
- It's saved with the name "gridPrice" in a storage area called "solar_rx"
- When the ESP32 starts up, it automatically loads the saved price
- If no price was saved before, it uses 12.0 cents/kWh as the default

**In simple terms:** The price is saved directly on the ESP32 device, not on a server or in the cloud. It's like saving a setting on your phone - it stays there until you change it.

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

**Location:** Inside the ESP32 device's permanent memory (like settings storage)

- Saved with the name "gridPrice"
- When you change the price, it's saved here
- When the ESP32 starts up, it loads the saved price
- **Important:** This stays saved even if you turn off the ESP32

**Think of it like:** A setting on your phone that you change once and it remembers

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
2. **Grid price is stored on ESP32** - survives power cycles
3. **Real-time data is automatically saved** - backend stores all telemetry
4. **If ESP32 is reset** - history data is safe in the cloud database
5. **No USB or tunneling needed** - ESP32 runs independently via MQTT

**In simple terms:** The ESP32 sends data via MQTT, the backend saves it in the cloud, and the dashboard displays it. Data is safe in the cloud even if the ESP32 is reset.

---

## Quick Summary

### 1. BATELEC Grid Price
- **Where it comes from:** User types it in the dashboard
- **Where it's saved:** Inside the ESP32 device's permanent memory
- **Stays saved:** Yes, even after power cycles

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
- **Grid price:** Saved permanently on ESP32 in settings storage
- **Live data:** Automatically saved to backend database via MQTT
- **Dashboard settings:** Managed via environment variables (Vercel)

**Key Takeaway:** Real-time data comes from ESP32 via MQTT. Historical data is stored in the cloud database. Data is safe in the cloud even if ESP32 is reset. No USB or tunneling needed - everything works via MQTT.

---

*Document created for panel presentation - Easy-to-understand answers*