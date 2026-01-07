# MQTT Topic Design for Solar Tracker

## Topic Structure

All topics follow the pattern: `solar-tracker/{device_id}/{message_type}`

### Base Pattern
```
solar-tracker/{device_id}/telemetry
solar-tracker/{device_id}/status
solar-tracker/{device_id}/history
```

### Device ID Format
- Generated from MAC address: `esp32-receiver-{MAC_6chars}`
- Example: `esp32-receiver-A1B2C3`
- Stored in ESP32 Preferences for persistence

## Topic Details

### 1. Telemetry Topic
**Topic:** `solar-tracker/{device_id}/telemetry`  
**QoS:** 1 (At least once delivery)  
**Retained:** false  
**Publish Frequency:** Every 350ms (matches telemetry rate)

**Message Format (JSON):**
```json
{
  "timestamp": 1703123456789,
  "device_id": "esp32-receiver-A1B2C3",
  "top": 2500,
  "left": 2300,
  "right": 2400,
  "avg": 2350,
  "horizontalError": 100,
  "verticalError": 150,
  "tiltAngle": 90,
  "panAngle": 85,
  "panTarget": 90,
  "manual": false,
  "steady": true,
  "powerW": 8.5,
  "powerActualW": 8.2,
  "tempC": 34.5,
  "batteryPct": 87.5,
  "batteryV": 6.2,
  "efficiency": 88.0,
  "energyWh": 1250.5,
  "energyKWh": 1.2505,
  "co2kg": 0.5002,
  "trees": 0.0230,
  "phones": 104.2,
  "phoneMinutes": 75030,
  "pesos": 15.01,
  "gridPrice": 12.0,
  "deviceName": "iPhone_15",
  "mode": "live"
}
```

**Field Descriptions:**
- `timestamp`: Milliseconds since ESP32 boot (or Unix timestamp if available)
- `device_id`: Unique device identifier
- `top`, `left`, `right`, `avg`: LDR sensor readings (0-4095)
- `horizontalError`, `verticalError`: Tracking error values
- `tiltAngle`, `panAngle`, `panTarget`: Servo positions (degrees)
- `manual`: Boolean indicating manual override mode
- `steady`: Boolean indicating steady/locked state
- `powerW`, `powerActualW`: Power estimates (Watts)
- `tempC`: Panel temperature (Celsius)
- `batteryPct`, `batteryV`: Battery state of charge and voltage
- `efficiency`: Charging efficiency percentage
- `energyWh`, `energyKWh`: Cumulative energy harvested
- `co2kg`, `trees`: Environmental impact metrics
- `phones`, `phoneMinutes`: Marketing metrics
- `pesos`: Cost savings (PHP)
- `gridPrice`: Grid electricity price (PHP/kWh)
- `deviceName`: Currently charging device name
- `mode`: Operating mode ("live" or "demo")

### 2. Status Topic
**Topic:** `solar-tracker/{device_id}/status`  
**QoS:** 1 (At least once delivery)  
**Retained:** true (last known status available to new subscribers)  
**Publish Frequency:** On connect/disconnect, and periodically (every 60 seconds)

**Message Format (JSON):**
```json
{
  "status": "online",
  "timestamp": 1703123456789,
  "device_id": "esp32-receiver-A1B2C3",
  "wifi_connected": true,
  "wifi_ssid": "MyRouter",
  "sta_ip": "192.168.1.100",
  "mqtt_connected": true,
  "uptime_ms": 3600000
}
```

**Status Values:**
- `"online"`: Device is connected and operational
- `"offline"`: Device is disconnected (published as LWT - Last Will and Testament)

**LWT (Last Will and Testament):**
- Configured during MQTT connection
- Automatically published if device disconnects unexpectedly
- Topic: `solar-tracker/{device_id}/status`
- Message: `{"status":"offline","timestamp":...}`

### 3. History Topic (Optional)
**Topic:** `solar-tracker/{device_id}/history`  
**QoS:** 0 (Fire and forget)  
**Retained:** false  
**Publish Frequency:** Every 10 minutes (snapshot)

**Message Format (JSON):**
```json
{
  "timestamp": 1703123456789,
  "device_id": "esp32-receiver-A1B2C3",
  "energy_wh": 1250.5,
  "battery_pct": 87.5,
  "device_name": "iPhone_15",
  "session_min": 120
}
```

**Note:** This topic is optional. Historical data is primarily stored in the backend MySQL database. This topic can be used for real-time history snapshots if needed.

### 4. Control Topic
**Topic:** `solar-tracker/{device_id}/control`  
**QoS:** 1 (At least once delivery)  
**Retained:** false  
**Publish Frequency:** On-demand (when user changes settings in dashboard)

**Message Format (JSON):**
```json
{
  "gridPrice": 12.5,
  "deviceName": "iPhone 15",
  "startCharging": true
}
```

**Field Descriptions:**
- `gridPrice` (optional): Grid electricity price in cents/kWh (0-1000). Updates the ESP32's stored grid price value. Also saved to database when user clicks "Save" button.
- `deviceName` (optional): Device name string (max 24 characters). Updates the current session device name. Also saved to database when user clicks "Start Charging" button.
- `startCharging` (optional): Boolean flag to start a charging session. When true, triggers device name save to database if device name is provided.

**Usage:**
- Published by frontend dashboard when:
  - User clicks "Save" button for grid price (saves to database + sends via MQTT)
  - User clicks "Start Charging" button (saves device name to database + sends via MQTT)
- **Database Storage:** Grid price is saved to MySQL database (`grid_price` table). Device registration is saved to `device_registration` table when telemetry is received via MQTT
- ESP32 receiver subscribes to this topic and forwards commands to transmitter via ESP-NOW
- Transmitter processes commands and updates settings in Preferences (grid price) or session variable (device name)

**Example Control Messages:**
```json
// Update grid price only (saved to database when user clicks "Save")
{"gridPrice": 12.5}

// Update device name only (saved to database when user clicks "Start Charging")
{"deviceName": "iPhone 15"}

// Start charging session (saves device name to database if provided)
{"startCharging": true}
{"deviceName": "iPhone 15", "startCharging": true}

// Update both
{"gridPrice": 12.5, "deviceName": "iPhone 15"}
```

**Important Notes:**
- Grid price has **no default value** - user must input and click "Save"
- Device name is saved to database when "Start Charging" is clicked
- Both values persist in cloud database, not just on ESP32

## Wildcard Subscriptions

### Subscribe to All Devices
```
solar-tracker/+/telemetry    # All telemetry from all devices
solar-tracker/+/status       # All status messages from all devices
solar-tracker/+/history      # All history snapshots from all devices
solar-tracker/+/control      # All control commands (ESP32 receivers subscribe to their own device ID only)
```

### Subscribe to Specific Device
```
solar-tracker/esp32-receiver-A1B2C3/telemetry
solar-tracker/esp32-receiver-A1B2C3/status
solar-tracker/esp32-receiver-A1B2C3/history
solar-tracker/esp32-receiver-A1B2C3/control  # ESP32 receiver subscribes to its own control topic
```

## QoS Levels

- **Telemetry (QoS 1):** Critical data that must be delivered at least once. Prevents data loss during network interruptions.
- **Status (QoS 1):** Important for device monitoring. Retained messages ensure new subscribers know device state immediately.
- **History (QoS 0):** Non-critical snapshots. Loss is acceptable as primary storage is in database.
- **Control (QoS 1):** Important for settings updates. Ensures control commands are delivered reliably.

## Message Size

- **Telemetry:** ~800-1000 bytes (JSON)
- **Status:** ~200-300 bytes (JSON)
- **History:** ~150-200 bytes (JSON)

## Best Practices

1. **Device ID:** Use consistent device IDs across reboots (stored in Preferences)
2. **Timestamp:** Use millis() for relative time, or NTP for absolute time if available
3. **Error Handling:** ESP32 should handle MQTT connection failures gracefully
4. **Reconnection:** Automatic reconnection with exponential backoff
5. **Buffer Size:** Set MQTT client buffer to at least 2048 bytes for JSON messages

