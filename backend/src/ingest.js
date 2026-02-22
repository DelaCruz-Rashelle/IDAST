import { pool } from "./db.js";
import mqtt from "mqtt";
import { handleMqttError, handleDatabaseError } from "./errorHandler.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getMqttBrokerUrl() {
  const url = process.env.MQTT_BROKER_URL;
  if (!url) throw new Error("Missing required env var: MQTT_BROKER_URL");
  return url;
}

function getMqttUsername() {
  return process.env.MQTT_USERNAME || "";
}

function getMqttPassword() {
  return process.env.MQTT_PASSWORD || "";
}

function toBool01(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (s === "true" || s === "1") return 1;
    if (s === "false" || s === "0") return 0;
  }
  if (typeof v === "number") return v ? 1 : 0;
  return null;
}

function toNum(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNum(v);
  return n === null ? null : Math.trunc(n);
}

// MQTT message handler - processes telemetry from ESP32 (device = Solar Unit in this project)
async function handleMqttMessage(topic, message) {
  try {
    const telemetry = JSON.parse(message.toString());
    if (!telemetry || typeof telemetry !== "object") {
      handleMqttError(new Error("Invalid telemetry JSON"), topic, message);
      return;
    }

    await updateDeviceFromTelemetry(telemetry);
    console.log(`✅ Solar Unit registered from telemetry: ${telemetry.device_id || "unknown"}`);
  } catch (err) {
    handleMqttError(err, topic, message);
  }
}

export async function updateDeviceFromTelemetry(t) {
  // Register Solar Unit from telemetry (device_name = Solar Name from dashboard/firmware)
  if (t.deviceName && (t.deviceName.trim() !== "" && t.deviceName.trim().toLowerCase() !== "unknown")) {
    const deviceName = t.deviceName.trim();
    
    try {
      // Ensure device is registered (create if doesn't exist, update timestamp if exists)
      await pool.execute(
        `INSERT INTO device_registration (device_name) 
         VALUES (?)
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
        [deviceName]
      );
    } catch (error) {
      handleDatabaseError(error, "register device from telemetry");
      throw error; // Re-throw to allow caller to handle
    }
  }

  // Store telemetry in device_state (for Solar metrics and energy history)
  if (t.deviceName && (t.deviceName.trim() !== "" && t.deviceName.trim().toLowerCase() !== "unknown")) {
    const deviceName = t.deviceName.trim();
    const energyWh = toNum(t.energyWh) ?? toNum(t.energy_wh) ?? null;
    const batteryPct = toNum(t.batteryPct) ?? toNum(t.battery_pct) ?? null;
    const ts = t.ts ? new Date(t.ts) : new Date();

    try {
      // Insert new device state entry (allows multiple entries per device for history)
      await pool.execute(
        `INSERT INTO device_state (device_name, energy_wh, battery_pct, ts) 
         VALUES (?, ?, ?, ?)`,
        [deviceName, energyWh, batteryPct, ts]
      );
    } catch (error) {
      handleDatabaseError(error, "save device_state from telemetry");
      // Don't throw - allow device registration to succeed even if state save fails
    }
  }
}

export function startIngestLoop({ logger = console } = {}) {
  logger.log("MQTT ingest starting...");

  const brokerUrl = getMqttBrokerUrl();
  const username = getMqttUsername();
  const password = getMqttPassword();

  logger.log(`Connecting to MQTT broker: ${brokerUrl}`);
  if (username) {
    logger.log(`Using authentication: ${username}`);
  }

  const clientId = `idast-backend-${Date.now()}`;
  const connectOptions = {
    clientId,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  if (username && password) {
    connectOptions.username = username;
    connectOptions.password = password;
  }

  const client = mqtt.connect(brokerUrl, connectOptions);

  client.on("connect", () => {
    logger.log("✅ MQTT client connected");
    
    // Subscribe to all device telemetry topics
    const telemetryTopic = "solar-tracker/+/telemetry";
    client.subscribe(telemetryTopic, { qos: 1 }, (err) => {
      if (err) {
        logger.error(`Failed to subscribe to ${telemetryTopic}:`, err);
      } else {
        logger.log(`✅ Subscribed to: ${telemetryTopic}`);
      }
    });

    // Optionally subscribe to status topics for monitoring
    const statusTopic = "solar-tracker/+/status";
    client.subscribe(statusTopic, { qos: 1 }, (err) => {
      if (err) {
        logger.error(`Failed to subscribe to ${statusTopic}:`, err);
      } else {
        logger.log(`✅ Subscribed to: ${statusTopic}`);
      }
    });
  });

  client.on("message", async (topic, message) => {
    if (topic.includes("/telemetry")) {
      await handleMqttMessage(topic, message);
    } else if (topic.includes("/status")) {
      // Log status messages but don't store them
      try {
        const status = JSON.parse(message.toString());
        logger.log(`📡 Status update from ${status.device_id || "unknown"}: ${status.status}`);
      } catch (err) {
        // Ignore parse errors for status messages
      }
    }
  });

  client.on("error", (err) => {
    logger.error("MQTT client error:", err);
  });

  client.on("close", () => {
    logger.log("⚠️ MQTT client disconnected");
  });

  client.on("reconnect", () => {
    logger.log("🔄 MQTT client reconnecting...");
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.log("Shutting down MQTT client...");
    client.end();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return () => {
    shutdown();
  };
}


