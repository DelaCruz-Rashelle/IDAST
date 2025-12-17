# WiFi Configuration Guide

## Overview

The ESP32 receiver node now supports **dynamic WiFi configuration** via the web dashboard, eliminating the need to hardcode WiFi credentials in the Arduino code. This makes deployment and configuration much easier for end users.

## How It Works

### Architecture

1. **Initial State**: ESP32 starts in **Access Point (AP) mode** with SSID `Solar_Capstone_Admin` (password: `12345678`)
2. **Configuration**: User connects to AP, opens dashboard, and enters WiFi credentials
3. **Storage**: Credentials are saved to ESP32's **Preferences** (non-volatile storage)
4. **Connection**: ESP32 attempts to connect to the configured WiFi network
5. **Fallback**: If WiFi connection fails, ESP32 continues in AP mode

### Data Flow

```
User Dashboard (Browser)
    ↓ POST /wifi-config
ESP32 Web Server
    ↓ Save to Preferences
ESP32 Preferences (NVS)
    ↓ Load on boot
WiFi Station Connection
```

## Implementation Details

### Arduino Code Changes

#### 1. Removed Hardcoded Credentials

**Before:**
```cpp
const char* WIFI_SSID = "ZTE_2.4G_gTUNE3";
const char* WIFI_PASSWORD = "simbasimba";
```

**After:**
```cpp
String wifiSSID = "";
String wifiPassword = "";
bool wifiConfigured = false;
```

#### 2. Preferences Storage

WiFi credentials are stored in ESP32's Preferences (NVS - Non-Volatile Storage):

```cpp
settings.begin("solar_rx", false);
settings.putString("wifiSSID", newSSID);
settings.putString("wifiPassword", newPassword);
settings.end();
```

#### 3. New Endpoint: `/wifi-config`

**Method**: POST  
**Content-Type**: `application/x-www-form-urlencoded`

**Parameters:**
- `wifiSSID` (required): WiFi network name (max 32 characters)
- `wifiPassword` (optional): WiFi password (max 64 characters)

**Response:**
```json
{
  "ok": true,
  "message": "WiFi credentials saved. Reconnecting..."
}
```

**Error Response:**
```json
{
  "error": "WiFi SSID cannot be empty"
}
```

#### 4. Modified `initWiFiStation()`

- Loads credentials from Preferences instead of hardcoded values
- Only attempts connection if credentials are configured
- Provides clear serial output about connection status

#### 5. WiFi Reconnection

When new credentials are saved, ESP32:
1. Disconnects from current WiFi (if connected)
2. Saves new credentials to Preferences
3. Attempts to connect with new credentials
4. Falls back to AP mode if connection fails

### Dashboard Changes

#### 1. WiFi Configuration UI

Added a new section in the dashboard settings card:
- Shows current WiFi SSID (if configured)
- Shows connection status (Configured/Not connected)
- Edit button to change WiFi settings
- Input fields for SSID and password
- Save/Cancel buttons

#### 2. New Function: `sendWifiConfig()`

Sends WiFi credentials to ESP32 via `/wifi-config` endpoint:
- Handles proxy mode (via `/api/proxy`)
- Handles tunnel mode (via `/api/tunnel-proxy`)
- Handles direct AP mode connection
- Proper error handling and user feedback

#### 3. Status Display

The dashboard shows:
- Current WiFi SSID
- Connection status (✅ Configured / ⚠️ Not connected)
- Helpful messages for first-time setup

## Usage Instructions

### First-Time Setup

1. **Power on ESP32**
   - ESP32 starts in AP mode
   - SSID: `Solar_Capstone_Admin`
   - Password: `12345678`

2. **Connect to ESP32**
   - Connect your computer/phone to the `Solar_Capstone_Admin` WiFi network
   - Open browser: `http://192.168.4.1`

3. **Configure WiFi**
   - In the dashboard, scroll to "WiFi Configuration" section
   - Click "Configure WiFi"
   - Enter your WiFi network name (SSID)
   - Enter WiFi password (if required)
   - Click "Save WiFi"

4. **Wait for Connection**
   - ESP32 will attempt to connect (10-30 seconds)
   - Check Serial Monitor for connection status
   - Once connected, ESP32 will show its IP address

5. **Set Up Remote Access** (Optional)
   - Use the ESP32's IP address for Cloudflare tunnel setup
   - Or use proxy mode if ESP32 has public IP

### Changing WiFi Settings

1. Connect to ESP32 (via AP mode or existing WiFi)
2. Open dashboard
3. In WiFi Configuration section, click "Change WiFi Settings"
4. Enter new SSID and password
5. Click "Save WiFi"
6. ESP32 will reconnect with new credentials

### Troubleshooting

#### ESP32 Won't Connect to WiFi

**Check Serial Monitor:**
- Look for error messages
- Verify SSID is correct (case-sensitive)
- Verify password is correct
- Check if network is 2.4GHz (ESP32 doesn't support 5GHz)

**Common Issues:**
- **Wrong password**: Double-check password spelling
- **Network not found**: Ensure network is 2.4GHz and in range
- **Timeout**: Network may be slow to respond, try again

#### Can't Access Dashboard After WiFi Change

**Solution:**
1. ESP32 will fall back to AP mode if WiFi connection fails
2. Reconnect to `Solar_Capstone_Admin` AP
3. Reconfigure WiFi with correct credentials

#### Forgot WiFi Password

**Reset Options:**
1. **Via Serial Monitor**: Clear Preferences and restart
2. **Via Code**: Upload code that clears Preferences:
   ```cpp
   Preferences settings;
   settings.begin("solar_rx", false);
   settings.clear();
   settings.end();
   ```

## Technical Details

### Storage Format

WiFi credentials are stored in ESP32's NVS (Non-Volatile Storage):
- **Namespace**: `solar_rx`
- **Keys**: `wifiSSID`, `wifiPassword`
- **Type**: String (max 32 chars for SSID, 64 chars for password)

### Security Considerations

1. **AP Password**: The AP password (`12345678`) is hardcoded but can be changed in code
2. **WiFi Password**: Stored in plaintext in NVS (standard ESP32 limitation)
3. **HTTPS**: Consider using HTTPS for production deployments
4. **Access Control**: Add authentication to `/wifi-config` endpoint if needed

### Limitations

1. **2.4GHz Only**: ESP32 only supports 2.4GHz WiFi networks
2. **Password Length**: Maximum 64 characters
3. **SSID Length**: Maximum 32 characters
4. **No WPA3**: ESP32 supports WPA/WPA2, not WPA3

## Code References

### Arduino Files
- `docs/arduino/arduino.md` - Main ESP32 code with WiFi configuration

### Dashboard Files
- `pages/dashboard.js` - WiFi configuration UI and handlers
- `pages/api/proxy.js` - Proxy endpoint for WiFi config (proxy mode)
- `pages/api/tunnel-proxy.js` - Proxy endpoint for WiFi config (tunnel mode)

### Key Functions

**Arduino:**
- `handle_wifi_config()` - Handles WiFi config POST requests
- `initWiFiStation()` - Loads and uses stored WiFi credentials
- `reconnectWiFi()` - Reconnects with new credentials
- `loadSettings()` - Loads Preferences (including WiFi)

**Dashboard:**
- `sendWifiConfig()` - Sends WiFi credentials to ESP32
- `handleSaveWifi()` - Handles save button click
- WiFi configuration UI component

## Future Enhancements

Possible improvements:
1. **WiFi Network Scanner**: Show available networks in dashboard
2. **Multiple WiFi Profiles**: Store multiple networks, auto-switch
3. **Connection Status API**: Real-time WiFi connection status
4. **WiFi Strength Indicator**: Show signal strength in dashboard
5. **Auto-Reconnect**: Automatic reconnection on WiFi drop
6. **WPS Support**: One-button WiFi setup via WPS

## Summary

✅ **WiFi credentials are no longer hardcoded**  
✅ **Users configure WiFi via web dashboard**  
✅ **Credentials stored in non-volatile storage**  
✅ **Automatic reconnection on credential change**  
✅ **Fallback to AP mode if connection fails**  
✅ **Works with all connection modes (AP, Proxy, Tunnel)**

This implementation makes the ESP32 much more user-friendly and eliminates the need to modify code for different WiFi networks!

