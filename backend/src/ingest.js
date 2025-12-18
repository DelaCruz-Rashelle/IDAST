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

// MQTT message handler - processes telemetry messages from ESP32
async function handleMqttMessage(topic, message) {
  try {
    const telemetry = JSON.parse(message.toString());
    if (!telemetry || typeof telemetry !== "object") {
      handleMqttError(new Error("Invalid telemetry JSON"), topic, message);
      return;
    }
    
    // Insert telemetry into database
    await insertTelemetryRow(telemetry);
    console.log(`✅ Telemetry stored from device: ${telemetry.device_id || "unknown"}`);
  } catch (err) {
    handleMqttError(err, topic, message);
  }
}

export async function insertTelemetryRow(t) {
  const rawJson = JSON.stringify(t);
  const sql = `
    INSERT INTO telemetry (
      device_name,
      top, \`left\`, \`right\`, \`avg\`, horizontal_error, vertical_error,
      tilt_angle, pan_angle, pan_target, \`manual\`, steady,
      power_w, power_actual_w, temp_c,
      battery_pct, battery_v, efficiency,
      energy_wh, energy_kwh,
      co2_kg, trees, phones, phone_minutes, pesos, grid_price,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
  `;

  const params = [
    t.deviceName ?? null,
    toInt(t.top),
    toInt(t.left),
    toInt(t.right),
    toInt(t.avg),
    toInt(t.horizontalError),
    toInt(t.verticalError),
    toInt(t.tiltAngle),
    toInt(t.panAngle),
    toInt(t.panTarget),
    toBool01(t.manual),
    toBool01(t.steady),
    toNum(t.powerW),
    toNum(t.powerActualW),
    toNum(t.tempC),
    toNum(t.batteryPct),
    toNum(t.batteryV),
    toNum(t.efficiency),
    toNum(t.energyWh),
    toNum(t.energyKWh),
    toNum(t.co2kg),
    toNum(t.trees),
    toNum(t.phones),
    toNum(t.phoneMinutes),
    toNum(t.pesos),
    toNum(t.gridPrice),
    rawJson,
  ];

  try {
    await pool.execute(sql, params);
  } catch (error) {
    handleDatabaseError(error, "insert telemetry");
    throw error; // Re-throw to allow caller to handle
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


