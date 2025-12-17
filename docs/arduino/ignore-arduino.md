Old

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
 * Update WIFI_SSID and WIFI_PASSWORD with your network credentials for tunneling.
 */

// === WiFi / AP settings ===
const char* AP_SSID     = "Solar_Capstone_Admin";
const char* AP_PASSWORD = "12345678";

// === WiFi Station settings (for tunneling) ===
const char* WIFI_SSID     = "ZTE_2.4G_gTUNE3";      // Replace with your WiFi network name
const char* WIFI_PASSWORD = "simbasimba";  // Replace with your WiFi password

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
  Serial.println("\n📶 Connecting to WiFi network...");
  Serial.printf("   SSID: %s\n", WIFI_SSID);
  
  // Set WiFi mode explicitly before connecting
  WiFi.mode(WIFI_STA);
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
    if (WiFi.SSID(i) == WIFI_SSID) {
      foundSSID = true;
      Serial.printf("   ✅ Found target SSID on channel %d\n", WiFi.channel(i));
    }
  }
  
  if (!foundSSID) {
    Serial.println("   ⚠️ Target SSID not found in scan!");
  }
  
  // Now try to connect
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {  // Increased to 20 seconds
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
    Serial.println(staIP);
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.printf("   Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("   Subnet:  %s\n", WiFi.subnetMask().toString().c_str());
  } else {
    Serial.printf("❌ WiFi Station connection failed! Status code: %d\n", WiFi.status());
    Serial.println("   Device will continue in AP mode only");
    Serial.printf("   AP IP: %s\n", WiFi.softAPIP().toString().c_str());
  }
}

void initEspNow() {
  WiFi.mode(WIFI_AP_STA);
  
  // Connect to WiFi network first
  initWiFiStation();
  
  // Then set up Access Point (fallback)
  WiFi.softAP(AP_SSID, AP_PASSWORD, WIFI_CHANNEL, 0);
  Serial.printf("📡 Receiver AP MAC: %s | STA MAC: %s | channel: %u\n",
                WiFi.softAPmacAddress().c_str(),
                WiFi.macAddress().c_str(),
                WIFI_CHANNEL);

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
    json += "\"deviceName\":\"" + currentDevice + "\"";
  } else {
    // If we don't yet have live telemetry, expose a stable-looking baseline snapshot
    json += "\"mode\":\"live\",";
    json += "\"top\":2800,";
    json += "\"left\":2750,";
    json += "\"right\":2780,";
    json += "\"avg\":2775,";
    json += "\"horizontalError\":-30,";
    json += "\"verticalError\":120,";
    json += "\"tiltAngle\":88,";
    json += "\"panCmd\":92,";
    json += "\"steady\":false,";
    json += "\"manual\":false,";
    json += "\"panTarget\":92,";
    json += "\"panAngle\":92,";
    json += "\"panSlider\":0,";
    json += "\"minTilt\":50,";
    json += "\"maxTilt\":110,";
    json += "\"minPan\":50,";
    json += "\"maxPan\":130,";
    json += "\"simTop\":2850,";
    json += "\"simLeft\":2720,";
    json += "\"simRight\":2790,";
    json += "\"simHErr\":-70,";
    json += "\"simVErr\":130,";
    json += "\"simTilt\":89,";
    json += "\"powerW\":6.20,";
    json += "\"powerActualW\":6.05,";
    json += "\"tempC\":38.7,";
    json += "\"batteryPct\":82.4,";
    json += "\"batteryV\":6.45,";
    json += "\"efficiency\":89.3,";
    json += "\"energyWh\":118.6,";
    json += "\"energyKWh\":0.1186,";
    json += "\"co2kg\":0.0474,";
    json += "\"trees\":0.0022,";
    json += "\"phones\":9.9,";
    json += "\"phoneMinutes\":711,";
    json += "\"pesos\":" + String(gridPriceRx * 0.1186f, 2) + ",";
    json += "\"gridPrice\":" + String(gridPriceRx, 2) + ",";
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
      settings.putFloat("gridPrice", newPrice);
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
}

void setup() {
  Serial.begin(115200);
  loadSettings();
  initFilesystem();
  initEspNow();

  server.on("/", handle_root);
  server.on("/data", handle_data);
  server.on("/control", HTTP_POST, handle_control);
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
  }
}

void loop() {
  server.handleClient();
}