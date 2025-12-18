#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_now.h>
#include <esp_wifi.h>

/**
 * Dual-ESP32 architecture — Receiver/Webserver node
 * --------------------------------------------------
 * Responsibilities:
 *  • Receive telemetry packets from the transmitter via ESP-NOW
 *  • Relay manual controls & grid price updates back to the transmitter
 *  • Host the LittleFS-based dashboard (index.html) + REST endpoints
 *
 * Update TRANSMITTER_MAC with the actual transmitter MAC before deployment.
 * WiFi credentials are configured via the web dashboard (not hardcoded).
 */

// === WiFi / AP settings ===
const char* AP_SSID     = "Solar_Capstone_Admin";
const char* AP_PASSWORD = "12345678";

// === WiFi Station settings (loaded from Preferences, not hardcoded) ===
String wifiSSID = "";
String wifiPassword = "";
bool wifiConfigured = false;

// === ESP-NOW MAC placeholders ===
const uint8_t WIFI_CHANNEL = 1;
// MAC address of the *transmitter* ESP32 (sensor/servo node)
uint8_t TRANSMITTER_MAC[6] = {0xF4, 0x65, 0x0B, 0x55, 0x40, 0x0C};

// === Web server ===
WebServer server(80);

// === Preferences (receiver-side persistence) ===
Preferences settings;

// === History logging ===
unsigned long lastHistoryLogMs = 0;
const unsigned long HISTORY_INTERVAL_MS = 600000; // 10 minutes

// === Telemetry data structures (shared with transmitter) ===
#pragma pack(push, 1)
struct TelemetryPacket {
  uint8_t version;
  uint32_t millisStamp;
  int16_t top;
  int16_t left;
  int16_t right;
  int16_t avg;
  int16_t horizontalError;
  int16_t verticalError;
  int16_t tiltAngle;
  int16_t panAngle;
  int16_t panTarget;
  uint8_t manual;
  uint8_t steady;
  float powerW;
  float powerActualW;
  float tempC;
  float batteryPct;
  float batteryV;
  float efficiency;
  float energyWh;
  float energyKWh;
  float co2kg;
  float trees;
  float phones;
  float phoneMinutes;
  float pesos;
  float gridPrice;
  int16_t simTop;
  int16_t simLeft;
  int16_t simRight;
  int16_t simHErr;
  int16_t simVErr;
  int16_t simTilt;
  char mode[8];
};

struct ControlPacket {
  uint8_t version;
  uint8_t flags;
  int16_t tiltValue;
  int16_t panSlider;
  uint8_t manualRequested;
  float gridPrice;
  char deviceName[24];
};
#pragma pack(pop)

  // === Latest telemetry cache ===
  TelemetryPacket latestTelemetry = {};
  bool hasTelemetry = false;
  unsigned long lastTelemetryMs = 0;

  // === Grid price mirror ===
  float gridPriceRx = 12.0f;

  // === Device info ===
  String currentDevice = "Unknown";

  // === Forward declarations ===
  void sendControlPacket(const ControlPacket &cmd);
  void seed_placeholder_history();
  void log_history_point(const TelemetryPacket &pkt);
  void initWiFiStation();
  void reconnectWiFi();

  void onDataSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
    (void)info;
    (void)status;
  }

  void onDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
    if (len == (int)sizeof(TelemetryPacket)) {
      memcpy(&latestTelemetry, incomingData, sizeof(TelemetryPacket));
      hasTelemetry = true;
      lastTelemetryMs = millis();
      gridPriceRx = latestTelemetry.gridPrice;
      currentDevice = currentDevice.length() ? currentDevice : "Unknown";

      if (millis() - lastHistoryLogMs >= HISTORY_INTERVAL_MS) {
        lastHistoryLogMs = millis();
        log_history_point(latestTelemetry);
      }
    }
    (void)info;
  }

  void initWiFiStation() {
    // Load WiFi credentials from Preferences
    settings.begin("solar_rx", true); // Read-only mode
    wifiSSID = settings.getString("wifiSSID", "");
    wifiPassword = settings.getString("wifiPassword", "");
    settings.end();
    
    wifiConfigured = (wifiSSID.length() > 0);
    
    if (!wifiConfigured) {
      Serial.println("\n📶 No WiFi credentials configured.");
      Serial.println("   Device will operate in AP mode only.");
      Serial.println("   Configure WiFi via the deployed app (WiFi Setup page).");
      return;
    }
    
    Serial.println("\n📶 Connecting to WiFi network...");
    Serial.printf("   SSID: %s\n", wifiSSID.c_str());
    
    // Keep AP_STA mode to maintain Access Point while connecting to router
    // Don't change WiFi mode - keep it as WIFI_AP_STA to maintain AP
    WiFi.disconnect();
    delay(100);
    
    // Scan for networks first to see what's available
    Serial.println("📡 Scanning for networks...");
    int n = WiFi.scanNetworks();
    Serial.printf("   Found %d networks\n", n);
    bool foundSSID = false;
    for (int i = 0; i < n; i++) {
      Serial.printf("   [%d] %s (RSSI: %d, Channel: %d)\n", 
                    i, WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
      if (WiFi.SSID(i) == wifiSSID) {
        foundSSID = true;
        Serial.printf("   ✅ Found target SSID on channel %d\n", WiFi.channel(i));
      }
    }
    
    if (!foundSSID) {
      Serial.println("   ⚠️ Target SSID not found in scan!");
    }
    
    // Now try to connect
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {  // 20 seconds timeout
      delay(500);
      Serial.print(".");
      attempts++;
      if (attempts % 10 == 0) {
        Serial.printf("\n   Status: %d\n", WiFi.status());
      }
    }
    Serial.println();
    
    if (WiFi.status() == WL_CONNECTED) {
      IPAddress staIP = WiFi.localIP();
      Serial.println("✅ WiFi Station connected!");
      Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      Serial.println("🌐 DEVICE IP ADDRESS FOR TUNNELING:");
      Serial.print("   ");
      Serial.println(WiFi.localIP());
      Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      Serial.printf("   Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
      Serial.printf("   Subnet:  %s\n", WiFi.subnetMask().toString().c_str());
    } else {
      Serial.printf("❌ WiFi Station connection failed! Status code: %d\n", WiFi.status());
      Serial.println("   Device will continue in AP mode only");
      Serial.printf("   AP IP: %s\n", WiFi.softAPIP().toString().c_str());
      Serial.println("   You can reconfigure WiFi via the deployed app (WiFi Setup page).");
    }
  }

void reconnectWiFi() {
  Serial.println("\n🔄 Reconnecting to WiFi with new credentials...");
  // Ensure AP_STA mode is maintained (AP should always be available)
  WiFi.mode(WIFI_AP_STA);
  WiFi.disconnect();
  delay(500);
  initWiFiStation();
}

  void initEspNow() {
    WiFi.mode(WIFI_AP_STA);
    
    // Set up Access Point first (always available)
    WiFi.softAP(AP_SSID, AP_PASSWORD, WIFI_CHANNEL, 0);
    Serial.printf("📡 Receiver AP MAC: %s | STA MAC: %s | channel: %u\n",
                  WiFi.softAPmacAddress().c_str(),
                  WiFi.macAddress().c_str(),
                  WIFI_CHANNEL);
    
    // Then try to connect to WiFi Station (if configured)
    initWiFiStation();
    
    if (esp_now_init() != ESP_OK) {
      Serial.println("❌ ESP-NOW init failed");
      return;
    }
    esp_now_register_send_cb(onDataSent);
    esp_now_register_recv_cb(onDataRecv);

    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, TRANSMITTER_MAC, 6);
    peerInfo.channel = WIFI_CHANNEL;
    peerInfo.encrypt = false;

    esp_err_t addStatus = esp_now_add_peer(&peerInfo);
    Serial.printf("📡 ESP-NOW add peer: %s\n",
                  addStatus == ESP_OK ? "OK" : String(addStatus).c_str());
    if (addStatus != ESP_OK) {
      Serial.println("❌ Failed to add transmitter peer");
    } else {
      Serial.println("✅ ESP-NOW peer configured");
    }
  }

  void initFilesystem() {
    if (!LittleFS.begin(true)) {
      Serial.println("❌ LittleFS mount failed! Formatting...");
      LittleFS.format();
      if (!LittleFS.begin(true)) {
        Serial.println("❌ LittleFS initialization failed!");
        return;
      }
    }
    Serial.println("✅ LittleFS initialized");

    if (!LittleFS.exists("/history.csv")) {
      File file = LittleFS.open("/history.csv", "w");
      if (file) {
        file.println("timestamp,energy_wh,battery_pct,device_name,session_min");
        file.close();
        Serial.println("✅ Created history.csv");
      }
    }
    seed_placeholder_history();
  }

  void log_history_point(const TelemetryPacket &pkt) {
    File file = LittleFS.open("/history.csv", "a");
    if (!file) {
      Serial.println("⚠️ Failed to open history.csv");
      return;
    }
    unsigned long now = millis();
    unsigned long sessionMinutes = now / 60000;
    file.printf("%lu,%.3f,%.1f,%s,%lu\n",
                pkt.millisStamp,
                pkt.energyWh,
                pkt.batteryPct,
                currentDevice.c_str(),
                sessionMinutes);
    file.close();
    Serial.println("📊 History entry appended");
  }

  void seed_placeholder_history() {
    // NOTE: Placeholder history seeding is DISABLED by default to avoid confusion
    // Uncomment the code below if you want demo/placeholder data for testing
    // For production, leave this function empty to start with real data only
    
    /*
    File test = LittleFS.open("/history.csv", "r");
    bool needsSeed = true;
    if (test) {
      int lines = 0;
      while (test.available()) {
        String line = test.readStringUntil('\n');
        line.trim();
        if (line.length() == 0) continue;
        lines++;
        if (lines > 1) {
          needsSeed = false;
          break;
        }
      }
      test.close();
    }
    if (!needsSeed) return;

    File file = LittleFS.open("/history.csv", "a");
    if (!file) return;

    const int placeholderDays = 60;
    const unsigned long baseTs = 1761340800UL;
    for (int i = placeholderDays - 1; i >= 0; --i) {
      unsigned long ts = baseTs + (unsigned long)i * 86400UL;
      float energyWh = 4.0f + 0.18f * (placeholderDays - i) + random(-10, 11) * 0.05f;
      float batteryPctSnapshot = constrain(72.0f + 6.0f * sinf((float)i / 7.0f), 65.0f, 96.0f);
      String device = (i % 3 == 0) ? "Galaxy_S24" : (i % 3 == 1 ? "iPhone_15" : "Tablet_A2");
      int sessionMinutes = 30 + (i % 5) * 10;
      file.printf("%lu,%.3f,%.1f,%s,%d\n", ts, energyWh, batteryPctSnapshot, device.c_str(), sessionMinutes);
    }
    file.close();
    Serial.println("✅ Seeded placeholder history");
    */
    
    // Start with empty history - real data will be logged as telemetry arrives
    Serial.println("ℹ️ History seeding disabled - starting with empty history");
  }

  void handle_root() {
    File file = LittleFS.open("/index.html", "r");
    if (file) {
      server.streamFile(file, "text/html");
      file.close();
    } else {
      server.send(200, "text/plain", "index.html missing in LittleFS");
    }
  }

  void sendTelemetryJson() {
    String json = "{";
    if (hasTelemetry) {
      json += "\"mode\":\"live\",";
      json += "\"top\":" + String(latestTelemetry.top) + ",";
      json += "\"left\":" + String(latestTelemetry.left) + ",";
      json += "\"right\":" + String(latestTelemetry.right) + ",";
      json += "\"avg\":" + String(latestTelemetry.avg) + ",";
      json += "\"horizontalError\":" + String(latestTelemetry.horizontalError) + ",";
      json += "\"verticalError\":" + String(latestTelemetry.verticalError) + ",";
      json += "\"tiltAngle\":" + String(latestTelemetry.tiltAngle) + ",";
      json += "\"panCmd\":" + String(latestTelemetry.panAngle) + ",";
      json += "\"steady\":" + String(latestTelemetry.steady ? "true" : "false") + ",";
      json += "\"manual\":" + String(latestTelemetry.manual ? "true" : "false") + ",";
      json += "\"panTarget\":" + String(latestTelemetry.panTarget) + ",";
      json += "\"panAngle\":" + String(latestTelemetry.panAngle) + ",";
      json += "\"panSlider\":" + String(latestTelemetry.panTarget) + ",";
      json += "\"minTilt\":50,";
      json += "\"maxTilt\":110,";
      json += "\"minPan\":50,";
      json += "\"maxPan\":130,";
      json += "\"simTop\":" + String(latestTelemetry.simTop) + ",";
      json += "\"simLeft\":" + String(latestTelemetry.simLeft) + ",";
      json += "\"simRight\":" + String(latestTelemetry.simRight) + ",";
      json += "\"simHErr\":" + String(latestTelemetry.simHErr) + ",";
      json += "\"simVErr\":" + String(latestTelemetry.simVErr) + ",";
      json += "\"simTilt\":" + String(latestTelemetry.simTilt) + ",";
      json += "\"powerW\":" + String(latestTelemetry.powerW, 2) + ",";
      json += "\"powerActualW\":" + String(latestTelemetry.powerActualW, 2) + ",";
      json += "\"tempC\":" + String(latestTelemetry.tempC, 1) + ",";
      json += "\"batteryPct\":" + String(latestTelemetry.batteryPct, 1) + ",";
      json += "\"batteryV\":" + String(latestTelemetry.batteryV, 2) + ",";
      json += "\"efficiency\":" + String(latestTelemetry.efficiency, 1) + ",";
      json += "\"energyWh\":" + String(latestTelemetry.energyWh, 3) + ",";
      json += "\"energyKWh\":" + String(latestTelemetry.energyKWh, 6) + ",";
      json += "\"co2kg\":" + String(latestTelemetry.co2kg, 4) + ",";
      json += "\"trees\":" + String(latestTelemetry.trees, 4) + ",";
      json += "\"phones\":" + String(latestTelemetry.phones, 3) + ",";
      json += "\"phoneMinutes\":" + String(latestTelemetry.phoneMinutes, 0) + ",";
      json += "\"pesos\":" + String(latestTelemetry.pesos, 2) + ",";
      json += "\"gridPrice\":" + String(latestTelemetry.gridPrice, 2) + ",";
      json += "\"wifiSSID\":\"" + wifiSSID + "\",";
      json += "\"wifiConfigured\":" + String(wifiConfigured ? "true" : "false") + ",";
      if (WiFi.status() == WL_CONNECTED) {
        json += "\"staIP\":\"" + WiFi.localIP().toString() + "\",";
        json += "\"wifiConnected\":true,";
      } else {
        json += "\"staIP\":\"\",";
        json += "\"wifiConnected\":false,";
      }
      json += "\"deviceName\":\"" + currentDevice + "\"";
    } else {
      // No telemetry data available - return null values to indicate no data
      // Frontend will display "--" for missing values
      json += "\"mode\":\"no_data\",";
      json += "\"top\":null,";
      json += "\"left\":null,";
      json += "\"right\":null,";
      json += "\"avg\":null,";
      json += "\"horizontalError\":null,";
      json += "\"verticalError\":null,";
      json += "\"tiltAngle\":null,";
      json += "\"panCmd\":null,";
      json += "\"steady\":false,";
      json += "\"manual\":false,";
      json += "\"panTarget\":null,";
      json += "\"panAngle\":null,";
      json += "\"panSlider\":null,";
      json += "\"minTilt\":50,";  // Keep limits as they're device config, not telemetry
      json += "\"maxTilt\":110,";
      json += "\"minPan\":50,";
      json += "\"maxPan\":130,";
      json += "\"simTop\":null,";
      json += "\"simLeft\":null,";
      json += "\"simRight\":null,";
      json += "\"simHErr\":null,";
      json += "\"simVErr\":null,";
      json += "\"simTilt\":null,";
      json += "\"powerW\":null,";
      json += "\"powerActualW\":null,";
      json += "\"tempC\":null,";
      json += "\"batteryPct\":null,";
      json += "\"batteryV\":null,";
      json += "\"efficiency\":null,";
      json += "\"energyWh\":null,";
      json += "\"energyKWh\":null,";
      json += "\"co2kg\":null,";
      json += "\"trees\":null,";
      json += "\"phones\":null,";
      json += "\"phoneMinutes\":null,";
      json += "\"pesos\":null,";
      json += "\"gridPrice\":" + String(gridPriceRx, 2) + ",";  // Keep grid price as it's stored locally
      json += "\"wifiSSID\":\"" + wifiSSID + "\",";
      json += "\"wifiConfigured\":" + String(wifiConfigured ? "true" : "false") + ",";
      if (WiFi.status() == WL_CONNECTED) {
        json += "\"staIP\":\"" + WiFi.localIP().toString() + "\",";
        json += "\"wifiConnected\":true,";
      } else {
        json += "\"staIP\":\"\",";
        json += "\"wifiConnected\":false,";
      }
      json += "\"deviceName\":\"" + currentDevice + "\"";
    }
    json += "}";
    server.send(200, "application/json", json);
  }

  void handle_data() {
    sendTelemetryJson();
  }

  void handle_control() {
    ControlPacket cmd = {};
    cmd.version = 1;

    if (server.hasArg("mode")) {
      cmd.flags |= 0x01;
      cmd.manualRequested = (server.arg("mode") == "manual") ? 1 : 0;
    }

    if (server.hasArg("tilt")) {
      cmd.flags |= 0x02;
      cmd.tiltValue = server.arg("tilt").toInt();
    }

    if (server.hasArg("pan")) {
      cmd.flags |= 0x04;
      cmd.panSlider = server.arg("pan").toInt();
    }

    if (server.hasArg("newPrice")) {
      float newPrice = server.arg("newPrice").toFloat();
      if (newPrice > 0 && newPrice < 1000) {
        cmd.flags |= 0x08;
        cmd.gridPrice = newPrice;
        gridPriceRx = newPrice;
        latestTelemetry.gridPrice = newPrice;
        settings.begin("solar_rx", false);
        settings.putFloat("gridPrice", newPrice);
        settings.end();
      }
    }

    if (server.hasArg("deviceName")) {
      String name = server.arg("deviceName");
      name.trim();
      currentDevice = name.length() ? name : "Unknown";
      cmd.flags |= 0x10;
      strncpy(cmd.deviceName, currentDevice.c_str(), sizeof(cmd.deviceName) - 1);
    }

    if (cmd.flags) {
      sendControlPacket(cmd);
    }

    server.send(200, "application/json", "{\"ok\":true}");
  }

  void handle_wifi_config() {
    // Handle WiFi configuration endpoint
    if (server.method() != HTTP_POST) {
      server.send(405, "application/json", "{\"error\":\"Method not allowed\"}");
      return;
    }

    String newSSID = "";
    String newPassword = "";
    
    if (server.hasArg("wifiSSID")) {
      newSSID = server.arg("wifiSSID");
      newSSID.trim();
    }
    
    if (server.hasArg("wifiPassword")) {
      newPassword = server.arg("wifiPassword");
    }

    // Validate input
    if (newSSID.length() == 0) {
      server.send(400, "application/json", "{\"error\":\"WiFi SSID cannot be empty\"}");
      return;
    }

    if (newSSID.length() > 32) {
      server.send(400, "application/json", "{\"error\":\"WiFi SSID too long (max 32 characters)\"}");
      return;
    }

    if (newPassword.length() > 64) {
      server.send(400, "application/json", "{\"error\":\"WiFi password too long (max 64 characters)\"}");
      return;
    }

    // Save to Preferences
    settings.begin("solar_rx", false);
    settings.putString("wifiSSID", newSSID);
    settings.putString("wifiPassword", newPassword);
    settings.end();

    // Update global variables
    wifiSSID = newSSID;
    wifiPassword = newPassword;
    wifiConfigured = true;

    Serial.println("\n✅ WiFi credentials saved:");
    Serial.printf("   SSID: %s\n", wifiSSID.c_str());
    Serial.println("   Password: [hidden]");

    // Reconnect WiFi with new credentials
    reconnectWiFi();

    server.send(200, "application/json", "{\"ok\":true,\"message\":\"WiFi credentials saved. Reconnecting...\"}");
  }

void handle_wifi_setup() {
  // Serve WiFi setup page in chunks to avoid memory issues
  server.sendHeader("Connection", "close");
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "text/html", "");
  
  // Send HTML in chunks
  server.sendContent("<!DOCTYPE html><html><head>");
  server.sendContent("<meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
  server.sendContent("<title>WiFi Setup</title>");
  server.sendContent("<style>");
  server.sendContent("*{margin:0;padding:0;box-sizing:border-box;}");
  server.sendContent("body{font-family:sans-serif;background:#0b1020;color:#e6f0ff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}");
  server.sendContent(".container{background:#121a33;border-radius:16px;padding:30px;max-width:400px;width:100%;}");
  server.sendContent(".header{text-align:center;margin-bottom:20px;}");
  server.sendContent(".header h1{font-size:24px;color:#2fd27a;margin-bottom:8px;}");
  server.sendContent(".header p{color:#9fb3d1;font-size:14px;}");
  server.sendContent(".form-group{margin-bottom:15px;}");
  server.sendContent(".form-group label{display:block;margin-bottom:6px;font-size:14px;}");
  server.sendContent(".form-group input{width:100%;padding:10px;background:#1b2547;border:1px solid #2a3a5c;border-radius:6px;color:#e6f0ff;font-size:14px;}");
  server.sendContent(".form-group input:focus{outline:none;border-color:#2fd27a;}");
  server.sendContent(".btn{width:100%;padding:12px;background:#2fd27a;color:#0b1020;border:none;border-radius:6px;font-size:16px;font-weight:600;cursor:pointer;margin-top:10px;}");
  server.sendContent(".btn:hover{background:#26b868;}");
  server.sendContent(".btn:disabled{background:#1b2547;color:#9fb3d1;cursor:not-allowed;}");
  server.sendContent(".message{padding:10px;border-radius:6px;margin-bottom:15px;font-size:13px;text-align:center;display:none;}");
  server.sendContent(".message.success{background:rgba(47,210,122,0.1);border:1px solid rgba(47,210,122,0.3);color:#2fd27a;}");
  server.sendContent(".message.error{background:rgba(245,179,66,0.1);border:1px solid rgba(245,179,66,0.3);color:#f5b342;}");
  server.sendContent(".info{background:rgba(47,210,122,0.1);border:1px solid rgba(47,210,122,0.3);border-radius:6px;padding:10px;margin-bottom:15px;font-size:12px;color:#9fb3d1;line-height:1.5;}");
  server.sendContent("</style></head><body>");
  server.sendContent("<div class=\"container\">");
  server.sendContent("<div class=\"header\"><h1>WiFi Configuration</h1><p>Enter Router WiFi Credentials</p></div>");
  server.sendContent("<div id=\"msg\"></div>");
  server.sendContent("<div class=\"info\"><strong>Instructions:</strong><br>1. Enter WiFi network name (SSID)<br>2. Enter WiFi password<br>3. Click Save & Connect</div>");
  server.sendContent("<form id=\"wf\">");
  server.sendContent("<div class=\"form-group\"><label>WiFi Network Name (SSID)</label>");
  server.sendContent("<input type=\"text\" id=\"ssid\" required maxlength=\"32\" placeholder=\"Enter WiFi network name\"></div>");
  server.sendContent("<div class=\"form-group\"><label>WiFi Password</label>");
  server.sendContent("<input type=\"password\" id=\"pwd\" maxlength=\"64\" placeholder=\"Enter WiFi password\"></div>");
  server.sendContent("<button type=\"submit\" class=\"btn\" id=\"btn\">Save & Connect</button>");
  server.sendContent("</form></div>");
  server.sendContent("<script>");
  server.sendContent("function showMsg(txt,typ){var m=document.getElementById('msg');m.textContent=txt;m.className='message '+typ;m.style.display='block';}");
  server.sendContent("document.getElementById('wf').onsubmit=function(e){e.preventDefault();var btn=document.getElementById('btn');var ssid=document.getElementById('ssid').value.trim();var pwd=document.getElementById('pwd').value;if(!ssid){showMsg('Please enter WiFi network name','error');return;}btn.disabled=true;btn.textContent='Saving...';var fd='wifiSSID='+encodeURIComponent(ssid)+'&wifiPassword='+encodeURIComponent(pwd);");
  server.sendContent("fetch('/wifi-config',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd}).then(function(r){return r.json();}).then(function(res){if(res.ok){showMsg('WiFi credentials saved! Connecting...','success');btn.textContent='Connecting...';var cnt=0;var iv=setInterval(function(){cnt++;fetch('/data').then(function(dr){return dr.json();}).then(function(d){if(d.wifiConnected&&d.staIP&&d.staIP.length>0){clearInterval(iv);showMsg('Connected! IP: '+d.staIP,'success');btn.textContent='Connected!';}else if(cnt>=30){clearInterval(iv);showMsg('Saved. Check Serial Monitor.','error');btn.disabled=false;btn.textContent='Save & Connect';}}).catch(function(){if(cnt>=30){clearInterval(iv);btn.disabled=false;btn.textContent='Save & Connect';}});},1000);}else{showMsg('Error: '+(res.error||'Failed'),'error');btn.disabled=false;btn.textContent='Save & Connect';}}).catch(function(err){showMsg('Error: '+err.message,'error');btn.disabled=false;btn.textContent='Save & Connect';});return false;};");
  server.sendContent("fetch('/data').then(function(r){return r.json();}).then(function(d){if(d.wifiSSID)document.getElementById('ssid').value=d.wifiSSID;if(d.wifiConnected&&d.staIP)showMsg('WiFi connected. IP: '+d.staIP,'success');}).catch(function(){});");
  server.sendContent("</script></body></html>");
  server.sendContent("");
  server.client().stop();
}

void handle_history() {
  File file = LittleFS.open("/history.csv", "r");
  if (!file) {
    server.send(200, "text/csv", "timestamp,energy_wh,battery_pct,device_name,session_min\n");
    return;
  }

  server.streamFile(file, "text/csv");
  file.close();
}

  void sendControlPacket(const ControlPacket &cmd) {
    esp_err_t result = esp_now_send(TRANSMITTER_MAC, (const uint8_t*)&cmd, sizeof(ControlPacket));
    if (result != ESP_OK) {
      Serial.printf("⚠️ Control packet send failed: %d\n", result);
    }
  }

  void loadSettings() {
    settings.begin("solar_rx", false);
    gridPriceRx = settings.getFloat("gridPrice", 12.0f);
    // WiFi credentials are loaded separately in initWiFiStation()
    settings.end();
  }

  void setup() {
    Serial.begin(115200);
    loadSettings();
    initFilesystem();
    initEspNow();

  server.on("/", handle_root);
  server.on("/wifi-setup", handle_wifi_setup);
  server.on("/data", handle_data);
  server.on("/control", HTTP_POST, handle_control);
  server.on("/wifi-config", HTTP_POST, handle_wifi_config);
  server.on("/api/history", handle_history);
  server.begin();
  Serial.println("✅ Receiver web server started");
  
  // Display connection info
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.println("🌐 ACCESS DEVICE VIA:");
    Serial.print("   http://");
    Serial.println(WiFi.localIP());
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } else {
    Serial.println("\n📡 Access Point Mode:");
    Serial.print("   http://");
    Serial.println(WiFi.softAPIP());
    Serial.println("   Configure WiFi via: http://" + WiFi.softAPIP().toString() + "/");
  }
}

void loop() {
  server.handleClient();
}