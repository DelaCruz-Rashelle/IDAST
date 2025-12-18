#include <Arduino.h>
#include <ESP32Servo.h>
#include <esp_now.h>
#include <WiFi.h>
#include <Preferences.h>
#include <esp_wifi.h>

/**
 * Dual-ESP32 architecture — Transmitter node
 * ------------------------------------------
 * Responsibilities:
 *  • Read LDR sensors and drive the dual-servo tracker
 *  • Run the existing energy/telemetry model
 *  • Send telemetry packets to the receiver/webserver ESP via ESP-NOW
 *  • Accept control packets from the receiver for manual overrides/grid price updates
 *
 * The receiver MAC address will be provided later. Update RECEIVER_MAC before flashing.
 */

// === Servo objects ===
Servo tiltServo;
Servo panServo;

// === LDR pins ===
const int LDR_TOP  = 35;
const int LDR_LEFT = 32;
const int LDR_RIGHT = 33;

// === Servo pins ===
const int tiltPin = 18;
const int panPin  = 19;

// === Tilt Servo Parameters ===
int tiltAngle = 90;
const int minTilt = 50;
const int maxTilt = 110;
const int tiltStep = 1;

// === Pan Servo Parameters ===
int panAngle = 90;
const int minPan = 50;
const int maxPan = 130;
const int panStep = 1;

// === Soft motion / targets ===
const float tiltSlewPerStep = 10.0f;
const float panSlewPerStep  = 10.0f;
int panTargetAngle = panAngle;
float tiltCommandActual = (float)tiltAngle;
float panCommandActual  = (float)panAngle;
int lastPanCmd = panAngle;

// === Manual override ===
bool manualOverride = false;
int manualPanSlider = 0;

// === Smoothing filter ===
float s_top = 0, s_left = 0, s_right = 0;
const float SM_ALPHA = 0.15f;

// === Deadbands / stability ===
const int deadbandHorizontal = 60;
const int deadbandVertical   = 60;
const int maxLightThreshold  = 3500;
const int steadyRange        = 120;
const int relaxRange         = 60;
bool steadyState = false;

// === Demo Mode ===
bool demoMode = false;  // Set to false to use real sensor data for energy calculations
int simTop = 0, simLeft = 0, simRight = 0;
int simTiltAngle = 90;
int simHErr = 0, simVErr = 0;
unsigned long lastSimUpdateMs = 0;

// === Persistent settings ===
Preferences settings;
float gridPrice = 12.0f;  // PHP per kWh (default)

// === Device Registration ===
String currentSessionDevice = "Unknown";

// === Energy model constants ===
const float panelMaxPowerW   = 10.0f;
const float chargeEfficiency = 0.85f;
const float baselineLoadW    = 0.8f;
const float batteryCapacityWh = 40.0f;
float batterySocPct = 78.0f;

// === Aggregates ===
float totalEnergyWh = 0.0f;
float totalCO2kg = 0.0f;
float treesEquivalent = 0.0f;

// Phone-charging marketing metrics
const float phoneChargeWh = 12.0f;
const float minutesPerWh = 60.0f;

float pseudoTempC = 34.0f;
float pseudoEfficiency = 88.0f;

unsigned long lastEnergyUpdateMs = 0;
unsigned long lastTelemetrySendMs = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 350;

// Latest actual readings
int lastTop = 0;
int lastLeft = 0;
int lastRight = 0;
int lastAvg = 0;
int lastHorizontalError = 0;
int lastVerticalError = 0;

// === ESP-NOW peer details (update with actual receiver MAC) ===
const uint8_t WIFI_CHANNEL = 1;
// MAC address of the *receiver/web UI* ESP32 (the AP STA MAC)
uint8_t RECEIVER_MAC[6] = {0x08, 0xD1, 0xF9, 0xEC, 0x00, 0xDC};

// === Data packets ===
#pragma pack(push, 1)
struct TelemetryPacket {
  uint8_t version = 1;
  uint32_t millisStamp = 0;
  int16_t top = 0;
  int16_t left = 0;
  int16_t right = 0;
  int16_t avg = 0;
  int16_t horizontalError = 0;
  int16_t verticalError = 0;
  int16_t tiltAngle = 0;
  int16_t panAngle = 0;
  int16_t panTarget = 0;
  uint8_t manual = 0;
  uint8_t steady = 0;
  float powerW = 0.0f;
  float powerActualW = 0.0f;
  float tempC = 0.0f;
  float batteryPct = 0.0f;
  float batteryV = 0.0f;
  float efficiency = 0.0f;
  float energyWh = 0.0f;
  float energyKWh = 0.0f;
  float co2kg = 0.0f;
  float trees = 0.0f;
  float phones = 0.0f;
  float phoneMinutes = 0.0f;
  float pesos = 0.0f;
  float gridPrice = 0.0f;
  int16_t simTop = 0;
  int16_t simLeft = 0;
  int16_t simRight = 0;
  int16_t simHErr = 0;
  int16_t simVErr = 0;
  int16_t simTilt = 0;
  char mode[8] = "live";
};

struct ControlPacket {
  uint8_t version = 1;
  uint8_t flags = 0;      // bit0: manual toggle, bit1: tilt, bit2: pan, bit3: grid price, bit4: device name
  int16_t tiltValue = 0;  // absolute degrees for tilt
  int16_t panSlider = 0;  // -100..100
  uint8_t manualRequested = 0;
  float gridPrice = 0.0f;
  char deviceName[24] = {0};
};
#pragma pack(pop)

// === Forward declarations ===
void sendTelemetry();
void set_manual_mode(bool enable);

// === Utility ===
float approach(float current, float target, float maxDelta) {
  if (current < target) {
    return min(current + maxDelta, target);
  }
  return max(current - maxDelta, target);
}

void apply_servo_outputs() {
  tiltCommandActual = approach(tiltCommandActual, (float)tiltAngle, tiltSlewPerStep);
  int tiltCmd = constrain((int)roundf(tiltCommandActual), minTilt, maxTilt);
  tiltServo.write(tiltCmd);

  panCommandActual = approach(panCommandActual, (float)panTargetAngle, panSlewPerStep);
  int panCmd = constrain((int)roundf(panCommandActual), minPan, maxPan);
  panServo.write(panCmd);
  lastPanCmd = panCmd;
}

int pan_angle_to_slider(int angle) {
  angle = constrain(angle, minPan, maxPan);
  float span = (float)(maxPan - minPan);
  if (span <= 0.5f) return 0;
  float ratio = (angle - minPan) / span;
  return (int)roundf(ratio * 200.0f - 100.0f);
}

int slider_to_pan_angle(int slider) {
  slider = constrain(slider, -100, 100);
  float ratio = (slider + 100.0f) / 200.0f;
  int angle = (int)roundf(minPan + ratio * (maxPan - minPan));
  return constrain(angle, minPan, maxPan);
}

void set_manual_mode(bool enable) {
  manualOverride = enable;
  manualPanSlider = pan_angle_to_slider(panAngle);
  if (!manualOverride) {
    panAngle = constrain(panAngle, minPan, maxPan);
    panTargetAngle = panAngle;
  } else {
    panTargetAngle = panAngle;
  }
}

void update_simulation() {
  unsigned long now = millis();
  if (now - lastSimUpdateMs < 200) return;
  lastSimUpdateMs = now;

  float t = (now % 60000) / 60000.0f;
  float daylight = 0.2f + 0.8f * (0.5f * (1.0f + sinf(2 * PI * t)));
  auto jitter = []() { return random(-35, 36); };

  int base = (int)(daylight * 3600);
  simLeft  = constrain(base + jitter() + 50 * sinf(2 * PI * t + 0.2f), 0, 4095);
  simRight = constrain(base + jitter() - 50 * sinf(2 * PI * t + 0.2f), 0, 4095);
  simTop   = constrain(base + jitter() + 80 * cosf(2 * PI * t), 0, 4095);

  int avg = (simLeft + simRight) / 2;
  simHErr = simLeft - simRight;
  simVErr = simTop - avg;

  if (abs(simVErr) > deadbandVertical) {
    if (simVErr > 0 && simTiltAngle < maxTilt) simTiltAngle -= tiltStep;
    else if (simVErr < 0 && simTiltAngle > minTilt) simTiltAngle += tiltStep;
  }
}

float estimate_panel_power_w(int avgLight, int horizontalError) {
  float lightNorm = constrain((float)avgLight / 4095.0f, 0.0f, 1.0f);
  float jitter = ((float)random(-5, 6)) / 100.0f;
  float alignPenalty = 1.0f - min(1.0f, (float)abs(horizontalError) / 700.0f);
  float power = panelMaxPowerW * max(0.0f, lightNorm + jitter) * max(0.0f, alignPenalty);
  return constrain(power, 0.0f, panelMaxPowerW);
}

float estimate_battery_voltage_v(float socPct) {
  float v = 5.6f + (6.9f - 5.6f) * constrain(socPct, 0.0f, 100.0f) / 100.0f;
  return v;
}

void update_energy_model(int avgLight, int horizontalError) {
  unsigned long now = millis();
  if (lastEnergyUpdateMs == 0) lastEnergyUpdateMs = now;
  unsigned long dtMs = now - lastEnergyUpdateMs;
  if (dtMs < 200) return;
  lastEnergyUpdateMs = now;

  float powerW = estimate_panel_power_w(avgLight, horizontalError);
  pseudoTempC = constrain(pseudoTempC + ((float)random(-2, 3)) / 10.0f, 28.0f, 55.0f);
  pseudoEfficiency = constrain(pseudoEfficiency + ((float)random(-2, 3)) / 10.0f, 80.0f, 95.0f);

  float netChargeW = powerW * chargeEfficiency - (powerW < 0.5f ? baselineLoadW : 0.0f);
  float dtHours = (float)dtMs / 3600000.0f;
  if (powerW > 0.1f) totalEnergyWh += powerW * dtHours;

  float deltaSocPct = (netChargeW * dtHours / batteryCapacityWh) * 100.0f;
  batterySocPct = constrain(batterySocPct + deltaSocPct, 0.0f, 100.0f);

  totalCO2kg = (totalEnergyWh / 1000.0f) * 0.4f;
  treesEquivalent = totalCO2kg / 21.77f;
}

// === ESP-NOW helpers ===
void onDataSent(const wifi_tx_info_t *info, esp_now_send_status_t status) {
  (void)info;
  Serial.printf("📡 ESP-NOW send status: %s\n",
                status == ESP_NOW_SEND_SUCCESS ? "SUCCESS" : "FAIL");
}

void handleControlPacket(const ControlPacket &cmd) {
  if (cmd.flags & 0x01) { // manual toggle
    set_manual_mode(cmd.manualRequested != 0);
  }
  if ((cmd.flags & 0x02) && manualOverride) { // tilt value
    tiltAngle = constrain(cmd.tiltValue, minTilt, maxTilt);
  }
  if ((cmd.flags & 0x04) && manualOverride) { // pan slider
    manualPanSlider = constrain(cmd.panSlider, -100, 100);
    panAngle = slider_to_pan_angle(manualPanSlider);
    panTargetAngle = panAngle;
  }
  if (cmd.flags & 0x08) { // grid price update
    if (cmd.gridPrice > 0 && cmd.gridPrice < 1000) {
      gridPrice = cmd.gridPrice;
      settings.putFloat("gridPrice", gridPrice);
      Serial.printf("✅ Grid price updated via receiver: %.2f PHP/kWh\n", gridPrice);
    }
  }
  if (cmd.flags & 0x10) { // device name update
    currentSessionDevice = String(cmd.deviceName);
    currentSessionDevice.trim();
    if (currentSessionDevice.length() == 0) currentSessionDevice = "Unknown";
  }

  Serial.printf("📥 Control packet -> flags:0x%02X manual:%d tilt:%d pan:%d price:%.2f device:%s\n",
                cmd.flags,
                cmd.manualRequested,
                cmd.tiltValue,
                cmd.panSlider,
                cmd.gridPrice,
                currentSessionDevice.c_str());
}

void onDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  if (len == (int)sizeof(ControlPacket)) {
    ControlPacket cmd;
    memcpy(&cmd, incomingData, sizeof(ControlPacket));
    if (cmd.version == 1) {
      handleControlPacket(cmd);
    }
  }
  (void)info;
}

void initEspNow() {
  WiFi.mode(WIFI_STA);

  // Lock the STA interface to the receiver's AP channel
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);
  Serial.printf("📡 Transmitter STA MAC: %s | channel: %u\n",
                WiFi.macAddress().c_str(), WIFI_CHANNEL);

  if (esp_now_init() != ESP_OK) {
    Serial.println("❌ Error initializing ESP-NOW");
    return;
  }
  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, RECEIVER_MAC, 6);
  peerInfo.channel = WIFI_CHANNEL;
  peerInfo.encrypt = false;
  esp_err_t addStatus = esp_now_add_peer(&peerInfo);
  Serial.printf("📡 ESP-NOW add peer: %s\n",
                addStatus == ESP_OK ? "OK" : String(addStatus).c_str());
  if (addStatus != ESP_OK) {
    Serial.println("❌ Failed to add receiver peer");
  } else {
    Serial.println("✅ ESP-NOW peer configured");
  }
}

void loadSettings() {
  settings.begin("solar_tx", false);
  float storedPrice = settings.getFloat("gridPrice", -1.0f);
  if (storedPrice > 0 && storedPrice < 1000) {
    gridPrice = storedPrice;
  } else {
    gridPrice = 12.0f;
    settings.putFloat("gridPrice", gridPrice);
  }
  Serial.printf("✅ Settings loaded. Grid price: %.2f PHP/kWh\n", gridPrice);
}

void setup_adc_for_ldr() {
  analogReadResolution(12);
  analogSetPinAttenuation(LDR_TOP, ADC_11db);
  analogSetPinAttenuation(LDR_LEFT, ADC_11db);
  analogSetPinAttenuation(LDR_RIGHT, ADC_11db);

  s_top = analogRead(LDR_TOP);
  s_left = analogRead(LDR_LEFT);
  s_right = analogRead(LDR_RIGHT);
}

int read_smoothed(int pin, float &state) {
  int raw = analogRead(pin);
  state = SM_ALPHA * raw + (1.0f - SM_ALPHA) * state;
  return (int)state;
}

void sendTelemetry() {
  TelemetryPacket pkt;
  pkt.millisStamp = millis();
  pkt.top = lastTop;
  pkt.left = lastLeft;
  pkt.right = lastRight;
  pkt.avg = lastAvg;
  pkt.horizontalError = lastHorizontalError;
  pkt.verticalError = lastVerticalError;
  pkt.tiltAngle = tiltAngle;
  pkt.panAngle = lastPanCmd;
  pkt.panTarget = panTargetAngle;
  pkt.manual = manualOverride ? 1 : 0;
  pkt.steady = steadyState ? 1 : 0;
  pkt.powerW = estimate_panel_power_w(lastAvg, lastHorizontalError);
  pkt.powerActualW = estimate_panel_power_w(lastAvg, lastHorizontalError);
  pkt.tempC = pseudoTempC;
  pkt.batteryPct = batterySocPct;
  pkt.batteryV = estimate_battery_voltage_v(batterySocPct);
  pkt.efficiency = pseudoEfficiency;
  pkt.energyWh = totalEnergyWh;
  pkt.energyKWh = totalEnergyWh / 1000.0f;
  pkt.co2kg = totalCO2kg;
  pkt.trees = treesEquivalent;
  pkt.phones = totalEnergyWh / phoneChargeWh;
  pkt.phoneMinutes = totalEnergyWh * minutesPerWh;
  pkt.pesos = (totalEnergyWh / 1000.0f) * gridPrice;
  pkt.gridPrice = gridPrice;
  pkt.simTop = simTop;
  pkt.simLeft = simLeft;
  pkt.simRight = simRight;
  pkt.simHErr = simHErr;
  pkt.simVErr = simVErr;
  pkt.simTilt = simTiltAngle;
  strncpy(pkt.mode, demoMode ? "demo" : "live", sizeof(pkt.mode));

  Serial.printf("📤 Telemetry -> top:%d left:%d right:%d avg:%d H:%d V:%d power:%.2fW batt:%.1f%% mode:%s\n",
                pkt.top, pkt.left, pkt.right, pkt.avg,
                pkt.horizontalError, pkt.verticalError,
                pkt.powerW, pkt.batteryPct, pkt.mode);

  esp_err_t result = esp_now_send(RECEIVER_MAC, (uint8_t*)&pkt, sizeof(pkt));
  if (result != ESP_OK) {
    Serial.printf("⚠️ Telemetry send failed: %d\n", result);
  }
}

void setup() {
  Serial.begin(115200);

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  tiltServo.setPeriodHertz(50);
  panServo.setPeriodHertz(50);

  tiltServo.attach(tiltPin, 500, 2400);
  panServo.attach(panPin, 500, 2400);

  tiltServo.write(tiltAngle);
  panServo.write(panAngle);
  tiltCommandActual = (float)tiltAngle;
  panCommandActual = (float)panAngle;
  panTargetAngle = panAngle;
  lastPanCmd = panAngle;

  setup_adc_for_ldr();
  delay(1000);
  Serial.println("✅ Transmitter initialized");

  randomSeed(esp_random());
  loadSettings();
  initEspNow();
}

void loop() {
  if (demoMode) update_simulation();

  int top   = read_smoothed(LDR_TOP, s_top);
  int left  = read_smoothed(LDR_LEFT, s_left);
  int right = read_smoothed(LDR_RIGHT, s_right);

  int avgHorizontal = (left + right) / 2;
  int verticalError = top - avgHorizontal;
  int horizontalError = left - right;

  int maxSensor = max(max(top, left), right);
  int absVerticalError = abs(verticalError);
  int absHorizontalError = abs(horizontalError);

  int effectiveVerticalDeadband = deadbandVertical;
  int effectiveHorizontalDeadband = deadbandHorizontal;
  if (maxSensor > 500) {
    effectiveVerticalDeadband = max(deadbandVertical, (int)(maxSensor * 0.08f));
    effectiveHorizontalDeadband = max(deadbandHorizontal, (int)(maxSensor * 0.08f));
  }

  if (!manualOverride && absVerticalError > effectiveVerticalDeadband) {
    if (verticalError > 0 && tiltAngle < maxTilt) {
      tiltAngle += tiltStep;
    } else if (verticalError < 0 && tiltAngle > minTilt) {
      tiltAngle -= tiltStep;
    }
    tiltAngle = constrain(tiltAngle, minTilt, maxTilt);
  }

  if (!manualOverride) {
    if (maxSensor > maxLightThreshold && absHorizontalError < steadyRange && absVerticalError < steadyRange) {
      steadyState = true;
    } else if (steadyState && absHorizontalError <= relaxRange && absVerticalError <= relaxRange) {
      // remain steady
    } else {
      steadyState = false;
      bool shouldPan = false;
      if (absHorizontalError > effectiveHorizontalDeadband) {
        if (top == maxSensor) {
          shouldPan = (absHorizontalError * 2.5f) > absVerticalError;
        } else {
          shouldPan = true;
        }
      }

      if (shouldPan) {
        if (horizontalError > 0 && panAngle > minPan) {
          panAngle = max(minPan, panAngle - panStep);
        } else if (horizontalError < 0 && panAngle < maxPan) {
          panAngle = min(maxPan, panAngle + panStep);
        }
      }
    }

    panAngle = constrain(panAngle, minPan, maxPan);
    panTargetAngle = panAngle;
    manualPanSlider = pan_angle_to_slider(panAngle);
  } else {
    steadyState = false;
  }

  apply_servo_outputs();

  lastTop = top;
  lastLeft = left;
  lastRight = right;
  lastAvg = avgHorizontal;
  lastHorizontalError = horizontalError;
  lastVerticalError = verticalError;

  int srcAvg = demoMode ? (simLeft + simRight) / 2 : lastAvg;
  int srcHErr = demoMode ? simHErr : lastHorizontalError;
  update_energy_model(srcAvg, srcHErr);

  if (millis() - lastTelemetrySendMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetrySendMs = millis();
    sendTelemetry();
  }

  delay(60);
}