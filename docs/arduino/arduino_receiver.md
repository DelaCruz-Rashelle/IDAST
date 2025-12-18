#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <PubSubClient.h>

/**
 * Dual-ESP32 architecture — Receiver/MQTT Publisher node
 * ---------------------------------------------------------
 * Responsibilities:
 *  • Receive telemetry packets from the transmitter via ESP-NOW
 *  • Publish telemetry data to EMQX Cloud via MQTT
 *  • Host minimal web interface for WiFi configuration (AP mode only)
 *
 * Update TRANSMITTER_MAC with the actual transmitter MAC before deployment.
 * WiFi credentials are configured via the web interface (AP mode).
 * MQTT credentials are configured via Preferences (set via serial or web interface).
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

// === Web server (minimal, for WiFi config only) ===
WebServer server(80);

// === Preferences (receiver-side persistence) ===
Preferences settings;

// === MQTT settings ===
const char* MQTT_BROKER_HOST = "j51075c2.ala.asia-southeast1.emqxsl.com";  // EMQX Cloud deployment
const int MQTT_BROKER_PORT = 8883;  // TLS/SSL port
String mqttUsername = "solar-tracker";
String mqttPassword = "Admin123!";
String deviceId = "";

// === MQTT client (using TLS/SSL) ===
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

// === MQTT publishing ===
unsigned long lastMqttPublishMs = 0;
const unsigned long MQTT_PUBLISH_INTERVAL_MS = 350;  // Match telemetry rate
bool mqttConnected = false;
unsigned long lastMqttReconnectAttempt = 0;
const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;

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
  void initMqtt();
  void reconnectMqtt();
  void publishTelemetry();
  String getDeviceId();
  void onMqttMessage(char* topic, byte* payload, unsigned int length);

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

      // Debug: Log when ESP-NOW data is received (only occasionally to avoid spam)
      static unsigned long lastRecvLog = 0;
      if (millis() - lastRecvLog > 5000) {  // Log every 5 seconds
        lastRecvLog = millis();
        Serial.printf("📥 ESP-NOW data received: top=%d, power=%.2fW, batt=%.1f%%\n",
                      latestTelemetry.top, latestTelemetry.powerW, latestTelemetry.batteryPct);
      }

      if (millis() - lastHistoryLogMs >= HISTORY_INTERVAL_MS) {
        lastHistoryLogMs = millis();
        log_history_point(latestTelemetry);
      }
    } else {
      // Debug: Log when wrong packet size is received
      Serial.printf("⚠️ ESP-NOW packet size mismatch: expected %d, got %d\n", 
                    sizeof(TelemetryPacket), len);
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
      Serial.println("   Configure WiFi via: http://192.168.4.1/wifi-setup");
      return;
    }
    
    Serial.println("\n📶 Connecting to WiFi network...");
    Serial.printf("   SSID: %s\n", wifiSSID.c_str());
    
    // Switch to STA mode for internet connectivity
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
      Serial.println("🌐 DEVICE IP ADDRESS:");
      Serial.print("   ");
      Serial.println(WiFi.localIP());
      Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      Serial.printf("   Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
      Serial.printf("   Subnet:  %s\n", WiFi.subnetMask().toString().c_str());
      
      // Disable AP mode after successful STA connection
      WiFi.mode(WIFI_STA);
      Serial.println("✅ AP mode disabled - device running in STA mode only");
      
      // Initialize MQTT after WiFi connection
      initMqtt();
    } else {
      Serial.printf("❌ WiFi Station connection failed! Status code: %d\n", WiFi.status());
      Serial.println("   Device will continue in AP mode only");
      // Re-enable AP mode if STA connection fails
      WiFi.mode(WIFI_AP);
      WiFi.softAP(AP_SSID, AP_PASSWORD, WIFI_CHANNEL, 0);
      Serial.printf("   AP IP: %s\n", WiFi.softAPIP().toString().c_str());
      Serial.println("   Configure WiFi via: http://" + WiFi.softAPIP().toString() + "/wifi-setup");
    }
  }

void reconnectWiFi() {
  Serial.println("\n🔄 Reconnecting to WiFi with new credentials...");
  // Disconnect MQTT first
  if (mqttClient.connected()) {
    mqttClient.disconnect();
    mqttConnected = false;
  }
  // Switch to STA mode
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(500);
  initWiFiStation();
}

  void initEspNow() {
    // Start in AP mode for initial WiFi configuration
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD, WIFI_CHANNEL, 0);
    Serial.printf("📡 Receiver AP MAC: %s | channel: %u\n",
                  WiFi.softAPmacAddress().c_str(),
                  WIFI_CHANNEL);
    Serial.println("📡 Access Point started for WiFi configuration");
    Serial.printf("   SSID: %s\n", AP_SSID);
    Serial.printf("   IP: %s\n", WiFi.softAPIP().toString().c_str());
    Serial.println("   Configure WiFi via: http://" + WiFi.softAPIP().toString() + "/wifi-setup");
    
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

  String getDeviceId() {
    if (deviceId.length() == 0) {
      // Generate device ID from MAC address if not set
      String mac = WiFi.macAddress();
      mac.replace(":", "");
      deviceId = "esp32-receiver-" + mac.substring(0, 6);
      // Save to Preferences
      settings.begin("solar_rx", false);
      settings.putString("deviceId", deviceId);
      settings.end();
    }
    return deviceId;
  }

  void initMqtt() {
    // Load MQTT settings from Preferences
    settings.begin("solar_rx", true);
    String brokerHost = settings.getString("mqttBroker", MQTT_BROKER_HOST);
    int brokerPort = settings.getInt("mqttPort", MQTT_BROKER_PORT);
    
    // Check if using default broker (EMQX Cloud) to set default credentials
    String defaultBroker = String(MQTT_BROKER_HOST);
    if (brokerHost == defaultBroker) {
      // Using default EMQX Cloud broker, use default credentials if not set
      mqttUsername = settings.getString("mqttUsername", "solar-tracker");
      mqttPassword = settings.getString("mqttPassword", "Admin123!");
    } else {
      // Custom broker, no default credentials
      mqttUsername = settings.getString("mqttUsername", "");
      mqttPassword = settings.getString("mqttPassword", "");
    }
    
    deviceId = settings.getString("deviceId", "");
    settings.end();
    
    if (deviceId.length() == 0) {
      deviceId = getDeviceId();
    }
    
    // Enable TLS (for testing - allows self-signed certs)
    // For production, you should use: wifiClient.setCACert(root_ca);
    wifiClient.setInsecure();
    
    mqttClient.setServer(brokerHost.c_str(), brokerPort);
    mqttClient.setBufferSize(2048);  // Increase buffer for JSON messages
    mqttClient.setCallback(onMqttMessage);  // Set callback for incoming messages
    
    Serial.println("\n📡 MQTT Configuration:");
    Serial.printf("   Broker: %s:%d (TLS)\n", brokerHost.c_str(), brokerPort);
    Serial.printf("   Device ID: %s\n", deviceId.c_str());
    Serial.printf("   Username: %s\n", mqttUsername.length() > 0 ? mqttUsername.c_str() : "[not set]");
    
    reconnectMqtt();
  }

  void reconnectMqtt() {
    if (WiFi.status() != WL_CONNECTED) {
      return;  // Can't connect to MQTT without WiFi
    }
    
    if (mqttClient.connected()) {
      mqttConnected = true;
      return;
    }
    
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt < MQTT_RECONNECT_INTERVAL_MS) {
      return;
    }
    lastMqttReconnectAttempt = now;
    
    Serial.print("🔄 Attempting MQTT connection...");
    String clientId = "ESP32-" + deviceId;
    
    // Always use authentication (credentials are set in initMqtt)
    bool connected = mqttClient.connect(
      clientId.c_str(), 
      mqttUsername.c_str(), 
      mqttPassword.c_str()
    );
    
    if (connected) {
      Serial.println(" ✅ Connected!");
      mqttConnected = true;
      
      // Publish status message
      String statusTopic = "solar-tracker/" + deviceId + "/status";
      String statusMsg = "{\"status\":\"online\",\"timestamp\":" + String(millis()) + "}";
      mqttClient.publish(statusTopic.c_str(), statusMsg.c_str(), true);  // Retained message
      
      // Subscribe to control topic
      String controlTopic = "solar-tracker/" + deviceId + "/control";
      if (mqttClient.subscribe(controlTopic.c_str(), 1)) {
        Serial.printf("✅ Subscribed to: %s\n", controlTopic.c_str());
      } else {
        Serial.printf("⚠️ Failed to subscribe to: %s\n", controlTopic.c_str());
      }
    } else {
      Serial.printf(" ❌ Failed, rc=%d\n", mqttClient.state());
      mqttConnected = false;
    }
  }

  void publishTelemetry() {
    if (!mqttClient.connected()) {
      return;
    }
    
    if (!hasTelemetry) {
      // Debug: Log when waiting for telemetry (only once per 10 seconds to avoid spam)
      static unsigned long lastNoTelemetryLog = 0;
      if (millis() - lastNoTelemetryLog > 10000) {
        lastNoTelemetryLog = millis();
        Serial.println("⏳ Waiting for ESP-NOW telemetry data from transmitter...");
      }
      return;
    }
    
    unsigned long now = millis();
    if (now - lastMqttPublishMs < MQTT_PUBLISH_INTERVAL_MS) {
      return;
    }
    lastMqttPublishMs = now;
    
    // Build JSON message
    String json = "{";
    json += "\"timestamp\":" + String(millis()) + ",";
    json += "\"device_id\":\"" + deviceId + "\",";
    json += "\"top\":" + String(latestTelemetry.top) + ",";
    json += "\"left\":" + String(latestTelemetry.left) + ",";
    json += "\"right\":" + String(latestTelemetry.right) + ",";
    json += "\"avg\":" + String(latestTelemetry.avg) + ",";
    json += "\"horizontalError\":" + String(latestTelemetry.horizontalError) + ",";
    json += "\"verticalError\":" + String(latestTelemetry.verticalError) + ",";
    json += "\"tiltAngle\":" + String(latestTelemetry.tiltAngle) + ",";
    json += "\"panAngle\":" + String(latestTelemetry.panAngle) + ",";
    json += "\"panTarget\":" + String(latestTelemetry.panTarget) + ",";
    json += "\"manual\":" + String(latestTelemetry.manual ? "true" : "false") + ",";
    json += "\"steady\":" + String(latestTelemetry.steady ? "true" : "false") + ",";
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
    json += "\"deviceName\":\"" + currentDevice + "\",";
    json += "\"mode\":\"" + String(latestTelemetry.mode) + "\"";
    json += "}";
    
    // Publish to MQTT topic
    String topic = "solar-tracker/" + deviceId + "/telemetry";
    bool published = mqttClient.publish(topic.c_str(), json.c_str(), false);  // QoS 1, not retained
    
    if (published) {
      // Debug: Log successful publish (only occasionally to avoid spam)
      static unsigned long lastPublishLog = 0;
      if (millis() - lastPublishLog > 5000) {  // Log every 5 seconds
        lastPublishLog = millis();
        Serial.printf("📤 Telemetry published: power=%.2fW, batt=%.1f%%, mode=%s\n", 
                      latestTelemetry.powerW, latestTelemetry.batteryPct, latestTelemetry.mode);
      }
    } else {
      Serial.println("⚠️ MQTT publish failed");
      mqttConnected = false;
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

  // Removed handle_data() - no longer serving HTTP telemetry endpoint
  // Telemetry is now published via MQTT only

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

  // Removed handle_history() - history is now published via MQTT or stored in backend

  void sendControlPacket(const ControlPacket &cmd) {
    esp_err_t result = esp_now_send(TRANSMITTER_MAC, (const uint8_t*)&cmd, sizeof(ControlPacket));
    if (result != ESP_OK) {
      Serial.printf("⚠️ Control packet send failed: %d\n", result);
    } else {
      Serial.printf("📤 Control packet sent via ESP-NOW: flags=0x%02X\n", cmd.flags);
    }
  }

  // MQTT message callback - handles incoming control commands
  void onMqttMessage(char* topic, byte* payload, unsigned int length) {
    // Null-terminate the payload
    char message[256];
    if (length >= sizeof(message)) length = sizeof(message) - 1;
    memcpy(message, payload, length);
    message[length] = '\0';
    
    String topicStr = String(topic);
    String messageStr = String(message);
    
    // Only process control topic messages
    if (!topicStr.endsWith("/control")) {
      return;
    }
    
    Serial.printf("📥 MQTT control message received: %s\n", messageStr.c_str());
    
    // Parse JSON manually (simple parsing for gridPrice and deviceName)
    // Expected format: {"gridPrice": 12.5, "deviceName": "iPhone 15"}
    ControlPacket cmd = {};
    cmd.version = 1;
    cmd.flags = 0;
    
    // Parse gridPrice
    int gridPriceIdx = messageStr.indexOf("\"gridPrice\"");
    if (gridPriceIdx >= 0) {
      int colonIdx = messageStr.indexOf(":", gridPriceIdx);
      if (colonIdx >= 0) {
        int endIdx = messageStr.indexOf(",", colonIdx);
        if (endIdx < 0) endIdx = messageStr.indexOf("}", colonIdx);
        if (endIdx > colonIdx) {
          String priceStr = messageStr.substring(colonIdx + 1, endIdx);
          priceStr.trim();
          float price = priceStr.toFloat();
          if (price > 0 && price < 1000) {
            cmd.gridPrice = price;
            cmd.flags |= 0x08;  // Set grid price flag
            Serial.printf("   Grid price: %.2f\n", price);
          }
        }
      }
    }
    
    // Parse deviceName
    int deviceNameIdx = messageStr.indexOf("\"deviceName\"");
    if (deviceNameIdx >= 0) {
      int colonIdx = messageStr.indexOf(":", deviceNameIdx);
      if (colonIdx >= 0) {
        int quote1 = messageStr.indexOf("\"", colonIdx);
        if (quote1 >= 0) {
          int quote2 = messageStr.indexOf("\"", quote1 + 1);
          if (quote2 > quote1) {
            String nameStr = messageStr.substring(quote1 + 1, quote2);
            nameStr.trim();
            if (nameStr.length() > 0 && nameStr.length() < 24) {
              nameStr.toCharArray(cmd.deviceName, sizeof(cmd.deviceName));
              cmd.flags |= 0x10;  // Set device name flag
              Serial.printf("   Device name: %s\n", cmd.deviceName);
            }
          }
        }
      }
    }
    
    // Forward control packet to transmitter via ESP-NOW if any flags are set
    if (cmd.flags != 0) {
      sendControlPacket(cmd);
    } else {
      Serial.println("⚠️ No valid control parameters found in message");
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
    delay(1000);
    Serial.println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Serial.println("🌞 Solar Tracker Receiver - MQTT Edition");
    Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    loadSettings();
    initFilesystem();
    initEspNow();

    // Minimal web server - only for WiFi configuration
    server.on("/wifi-setup", handle_wifi_setup);
    server.on("/wifi-config", HTTP_POST, handle_wifi_config);
    server.onNotFound([]() {
      server.send(200, "text/html", "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Solar Tracker</title></head><body><h1>Solar Tracker Receiver</h1><p>WiFi Configuration: <a href=\"/wifi-setup\">/wifi-setup</a></p><p>Device running in MQTT mode. Telemetry published to EMQX Cloud.</p></body></html>");
    });
    server.begin();
    Serial.println("✅ Minimal web server started (WiFi config only)");
    
    // Display connection info
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      Serial.println("🌐 WiFi Connected:");
      Serial.print("   IP: ");
      Serial.println(WiFi.localIP());
      Serial.println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    } else {
      Serial.println("\n📡 Access Point Mode:");
      Serial.print("   http://");
      Serial.println(WiFi.softAPIP());
      Serial.println("   Configure WiFi via: http://" + WiFi.softAPIP().toString() + "/wifi-setup");
    }
  }

void loop() {
  // Handle web server (for WiFi config)
  server.handleClient();
  
  // Handle MQTT
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      reconnectMqtt();
    } else {
      mqttClient.loop();
      publishTelemetry();
    }
  } else {
    // WiFi disconnected - try to reconnect
    if (wifiConfigured) {
      static unsigned long lastWiFiReconnect = 0;
      if (millis() - lastWiFiReconnect > 30000) {  // Try every 30 seconds
        lastWiFiReconnect = millis();
        Serial.println("🔄 WiFi disconnected, attempting reconnect...");
        initWiFiStation();
      }
    }
  }
}