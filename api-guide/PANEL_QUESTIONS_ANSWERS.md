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

2. **Loaded from the ESP32 device**
   - When the dashboard first opens, it asks the ESP32 what price is currently saved
   - This makes sure the dashboard shows the correct price

### How It Gets Saved

**Simple explanation:**
1. User types a new price in the dashboard
2. After 2.5 seconds (to avoid sending too many requests), the dashboard sends the new price to the ESP32
3. The ESP32 receives it and saves it permanently in its memory
4. The price stays saved even if the ESP32 is turned off and back on

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

The history data is stored on the ESP32 device and accessed through a web address called `/api/history`.

### Where It Lives

**On the ESP32 device:**
- The ESP32 has a built-in web server
- When you ask for `/api/history`, it responds with a CSV file containing all the energy history
- The CSV file is stored on the ESP32's internal storage

**In the dashboard code:**
- The dashboard has a function that asks the ESP32 for this history data
- It does this automatically every 30 seconds to keep the display updated

### How It Works

**Think of it like this:**
- The ESP32 is like a website that you can visit
- When you visit the address `/api/history`, it gives you a file with all the energy data
- The dashboard visits this address every 30 seconds to get the latest data

**Different ways to connect:**
1. **Direct connection:** Dashboard connects directly to ESP32 (like connecting to WiFi)
2. **Through a tunnel:** Dashboard connects through a Cloudflare tunnel (for remote access)
3. **Through a proxy:** Dashboard connects through a Next.js server that forwards the request

**In simple terms:** The history is stored on the ESP32 device. The dashboard asks for it every 30 seconds and displays it to the user.

---

## 3. Where is the content of the API? And where does the API come from?

### Simple Answer

The system has three main APIs (ways to communicate with the ESP32), and all the data comes from the ESP32 device itself.

### The Three APIs Explained

#### 1. `/data` - Real-Time Information

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
- The ESP32 reads all its sensors in real-time
- It packages this information into a JSON format
- The dashboard asks for this data every 0.35 seconds (very fast!) to show live updates

**Think of it like:** A live weather report that updates constantly

#### 2. `/api/history` - Historical Data

**What it contains:**
- A CSV file (like an Excel spreadsheet) with all past energy data
- Each row has: timestamp, energy used, battery level, device name, and session time

**Where it comes from:**
- Stored in a file called `/history.csv` on the ESP32's internal storage
- The ESP32 adds new data to this file periodically
- When you ask for `/api/history`, the ESP32 reads this file and sends it to you

**Think of it like:** A logbook that records everything that happened

#### 3. `/control` - Send Commands

**What it does:**
- Lets you send commands to the ESP32
- You can change settings like:
  - Switch between auto and manual mode
  - Adjust tilt and pan angles
  - Update the grid price
  - Set device name
  - Configure WiFi

**Where it comes from:**
- You send commands from the dashboard
- The ESP32 receives them and makes the changes

**Think of it like:** A remote control for the ESP32

### How the Dashboard Connects

Sometimes the dashboard can't talk directly to the ESP32 (like when they're far apart). So we use "middlemen" called proxies:

1. **Tunnel Proxy** - Uses Cloudflare tunnel to connect remotely
2. **Direct Proxy** - Connects through a Next.js server
3. **Direct Connection** - Connects directly when on the same network

**In simple terms:** All the data comes from the ESP32 device. The dashboard just asks for it and displays it. The ESP32 is like a smart device that can answer questions and follow commands.

---

## 4. Where is the data being saved?

### Simple Answer

Different types of data are saved in different places. Most important data is saved on the ESP32 device itself.

### Where Each Type of Data is Saved

#### 1. History Data (Energy Logs) - PERMANENT STORAGE

**Location:** Inside the ESP32 device, in a file called `/history.csv`

- This is like a spreadsheet file stored on the ESP32
- Each row records: when it happened, how much energy was used, battery level, device name, and session time
- The ESP32 adds new rows to this file automatically over time
- **Important:** This data stays saved even if you turn off the ESP32

**Think of it like:** A diary that the ESP32 writes in every day

#### 2. Grid Price - PERMANENT STORAGE

**Location:** Inside the ESP32 device's permanent memory (like settings storage)

- Saved with the name "gridPrice"
- When you change the price, it's saved here
- When the ESP32 starts up, it loads the saved price
- **Important:** This stays saved even if you turn off the ESP32

**Think of it like:** A setting on your phone that you change once and it remembers

#### 3. Real-Time Telemetry Data - NOT SAVED

**Location:** Only shown on the dashboard (temporary)

- This is the live data you see updating on the screen
- It's not saved anywhere - it's just for display
- If you refresh the page, it starts fresh
- The dashboard asks for this data every 0.35 seconds to keep it updated

**Think of it like:** A live TV feed - you can watch it, but it's not recorded

#### 4. Dashboard Settings - SEMI-PERMANENT

**Location:** In your web browser's storage

- Things like your tunnel URL or proxy settings
- These stay saved in your browser until you clear your browser data
- They're not on the ESP32, just in your browser

**Think of it like:** Your browser's bookmarks - they stay until you delete them

### Important Points to Remember

1. **All important data is on the ESP32** - not on a server or in the cloud
2. **History and grid price are permanent** - they survive power cycles
3. **Real-time data is temporary** - it's just for display
4. **If ESP32 is reset** - the history and settings will be lost (unless you have a backup)

**In simple terms:** The ESP32 is like a computer that saves its own data. The dashboard is like a monitor that shows you what's happening, but doesn't save anything important.

---

## Quick Summary

### 1. BATELEC Grid Price
- **Where it comes from:** User types it in the dashboard
- **Where it's saved:** Inside the ESP32 device's permanent memory
- **Stays saved:** Yes, even after power cycles

### 2. API/History Location
- **Where it is:** On the ESP32 device at the address `/api/history`
- **What it does:** Sends a CSV file with all energy history data
- **How often:** Dashboard checks every 30 seconds

### 3. API Content & Source
- **`/data`:** Live sensor readings from ESP32 (updates every 0.35 seconds)
- **`/api/history`:** Historical data from a CSV file on the ESP32
- **`/control`:** Commands you send to control the ESP32
- **All data comes from:** The ESP32 device itself

### 4. Data Storage
- **History data:** Saved permanently on ESP32 in `/history.csv` file
- **Grid price:** Saved permanently on ESP32 in settings storage
- **Live data:** Not saved, just displayed on screen
- **Dashboard settings:** Saved in your browser

**Key Takeaway:** All important data is stored on the ESP32 device itself, not on a server or in the cloud. The dashboard is just a way to view and control it.

---

*Document created for panel presentation - Easy-to-understand answers*