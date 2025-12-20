import mysql from "mysql2/promise";
import { handleDatabaseError } from "./errorHandler.js";

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Railway MySQL commonly provides these (or a MYSQL_URL / DATABASE_URL).
const MYSQL_HOST = process.env.MYSQL_HOST;
const MYSQL_PORT = process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : undefined;
const MYSQL_USER = process.env.MYSQL_USER;
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD;
const MYSQL_DATABASE = process.env.MYSQL_DATABASE;

const MYSQL_URL =
  process.env.MYSQL_URL ||
  process.env.DATABASE_URL || // some setups use DATABASE_URL even for MySQL
  null;

export const pool = mysql.createPool(
  MYSQL_URL
    ? MYSQL_URL
    : {
        host: requiredEnv("MYSQL_HOST"),
        port: MYSQL_PORT,
        user: requiredEnv("MYSQL_USER"),
        password: requiredEnv("MYSQL_PASSWORD"),
        database: requiredEnv("MYSQL_DATABASE"),
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        idleTimeout: 60_000,
        enableKeepAlive: true,
      }
);

export async function dbPing() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

// Initialize database schema (creates tables if they don't exist)
export async function initSchema() {
  const conn = await pool.getConnection();
  try {
    // Create telemetry table
    const telemetrySql = `CREATE TABLE IF NOT EXISTS telemetry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  device_name VARCHAR(64) NULL,

  top INT NULL,
  \`left\` INT NULL,
  \`right\` INT NULL,
  \`avg\` INT NULL,
  horizontal_error INT NULL,
  vertical_error INT NULL,

  tilt_angle INT NULL,
  pan_angle INT NULL,
  pan_target INT NULL,
  \`manual\` TINYINT(1) NULL,
  steady TINYINT(1) NULL,

  power_w DECIMAL(10,2) NULL,
  power_actual_w DECIMAL(10,2) NULL,
  temp_c DECIMAL(10,1) NULL,

  battery_pct DECIMAL(5,1) NULL,
  battery_v DECIMAL(6,2) NULL,
  efficiency DECIMAL(6,1) NULL,

  energy_wh DECIMAL(12,3) NULL,
  energy_kwh DECIMAL(12,6) NULL,

  co2_kg DECIMAL(12,4) NULL,
  trees DECIMAL(12,4) NULL,
  phones DECIMAL(12,3) NULL,
  phone_minutes DECIMAL(12,0) NULL,
  pesos DECIMAL(12,2) NULL,
  grid_price DECIMAL(12,2) NULL,

  raw_json JSON NULL,

  INDEX idx_ts (ts)
)`;
    await conn.query(telemetrySql);
    console.log("Database schema initialized (telemetry table ready)");

    // Create device table
    const deviceSql = `CREATE TABLE IF NOT EXISTS device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(24) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at)
)`;
    await conn.query(deviceSql);
    console.log("Database schema initialized (device table ready)");

    // Create grid_price table (with device connection)
    const gridPriceSql = `CREATE TABLE IF NOT EXISTS grid_price (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price DECIMAL(10,2) NOT NULL,
  device_name VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at),
  INDEX idx_device_name (device_name)
)`;
    await conn.query(gridPriceSql);
    console.log("Database schema initialized (grid_price table ready)");

    // Migration: Add device_name column if it doesn't exist (for existing databases)
    try {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grid_price' AND COLUMN_NAME = 'device_name'"
      );
      if (columns.length === 0) {
        console.log("[Migration] Adding device_name column to grid_price table...");
        await conn.query("ALTER TABLE grid_price ADD COLUMN device_name VARCHAR(64) NULL AFTER price");
        await conn.query("ALTER TABLE grid_price ADD INDEX idx_device_name (device_name)");
        console.log("[Migration] ✅ device_name column added to grid_price table");
      }
    } catch (migrationError) {
      // Migration errors are non-fatal - table might not exist yet or column might already exist
      console.log("[Migration] Note: device_name column migration skipped (may already exist)");
    }
  } catch (error) {
    handleDatabaseError(error, "schema initialization");
    throw error;
  } finally {
    conn.release();
  }
}

// Seed sample telemetry data for testing/display purposes
export async function seedSampleTelemetry() {
  const conn = await pool.getConnection();
  try {
    // Check if telemetry table already has data
    const [existingRows] = await conn.query("SELECT COUNT(*) as count FROM telemetry");
    const existingCount = existingRows[0]?.count || 0;
    
    // Only seed if table is empty (or if explicitly enabled via env var)
    const forceSeed = process.env.SEED_SAMPLE_DATA === "true";
    if (existingCount > 0 && !forceSeed) {
      console.log(`[Seed] Telemetry table already has ${existingCount} rows, skipping sample data`);
      return;
    }

    console.log("[Seed] Inserting 5 sample telemetry entries...");

    // Get current time and create timestamps for the last 5 days
    const now = new Date();
    const sampleData = [
      {
        device_name: "iPhone 15 Pro",
        energy_wh: 1250.5,
        energy_kwh: 1.2505,
        battery_pct: 85.5,
        battery_v: 4.15,
        power_w: 12.5,
        power_actual_w: 12.3,
        temp_c: 28.5,
        efficiency: 92.5,
        grid_price: 12.0,
        co2_kg: 0.625,
        trees: 0.031,
        phones: 1.25,
        phone_minutes: 450,
        pesos: 15.01,
        ts: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      },
      {
        device_name: "iPhone 14",
        energy_wh: 980.3,
        energy_kwh: 0.9803,
        battery_pct: 78.2,
        battery_v: 4.08,
        power_w: 10.2,
        power_actual_w: 10.0,
        temp_c: 29.1,
        efficiency: 90.8,
        grid_price: 12.0,
        co2_kg: 0.490,
        trees: 0.025,
        phones: 0.98,
        phone_minutes: 360,
        pesos: 11.76,
        ts: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      },
      {
        device_name: "Infinix Hot 50 Pro Plus",
        energy_wh: 2100.8,
        energy_kwh: 2.1008,
        battery_pct: 92.0,
        battery_v: 4.25,
        power_w: 18.5,
        power_actual_w: 18.2,
        temp_c: 27.8,
        efficiency: 94.2,
        grid_price: 12.0,
        co2_kg: 1.050,
        trees: 0.052,
        phones: 2.10,
        phone_minutes: 720,
        pesos: 25.21,
        ts: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      },
      {
        device_name: "Xiaomi Redmi 13C",
        energy_wh: 750.2,
        energy_kwh: 0.7502,
        battery_pct: 72.5,
        battery_v: 4.02,
        power_w: 8.5,
        power_actual_w: 8.3,
        temp_c: 30.2,
        efficiency: 88.5,
        grid_price: 12.0,
        co2_kg: 0.375,
        trees: 0.019,
        phones: 0.75,
        phone_minutes: 270,
        pesos: 9.00,
        ts: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      },
      {
        device_name: "Huawei Nova 5T",
        energy_wh: 1100.6,
        energy_kwh: 1.1006,
        battery_pct: 88.3,
        battery_v: 4.18,
        power_w: 11.8,
        power_actual_w: 11.6,
        temp_c: 28.9,
        efficiency: 91.5,
        grid_price: 12.0,
        co2_kg: 0.550,
        trees: 0.028,
        phones: 1.10,
        phone_minutes: 400,
        pesos: 13.21,
        ts: new Date(now.getTime() - 0.5 * 24 * 60 * 60 * 1000), // 12 hours ago
      },
    ];

    // Insert each sample entry
    for (const data of sampleData) {
      await conn.query(
        `INSERT INTO telemetry (
          device_name, energy_wh, energy_kwh, battery_pct, battery_v,
          power_w, power_actual_w, temp_c, efficiency,
          grid_price, co2_kg, trees, phones, phone_minutes, pesos, ts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.device_name,
          data.energy_wh,
          data.energy_kwh,
          data.battery_pct,
          data.battery_v,
          data.power_w,
          data.power_actual_w,
          data.temp_c,
          data.efficiency,
          data.grid_price,
          data.co2_kg,
          data.trees,
          data.phones,
          data.phone_minutes,
          data.pesos,
          data.ts,
        ]
      );
    }

    console.log("[Seed] ✅ Successfully inserted 5 sample telemetry entries");

    // Also insert device names into device table
    const deviceNames = [
      "iPhone 15 Pro",
      "iPhone 14",
      "Infinix Hot 50 Pro Plus",
      "Xiaomi Redmi 13C",
      "Huawei Nova 5T"
    ];

    for (const deviceName of deviceNames) {
      // Use INSERT IGNORE to avoid duplicate key errors if device already exists
      await conn.query(
        "INSERT IGNORE INTO device (device_name) VALUES (?)",
        [deviceName]
      );
    }

    console.log("[Seed] ✅ Successfully registered 5 sample devices");

    // Insert sample grid prices for each device
    const gridPrices = [
      { device_name: "iPhone 15 Pro", price: 12.0 },
      { device_name: "iPhone 14", price: 12.0 },
      { device_name: "Infinix Hot 50 Pro Plus", price: 12.0 },
      { device_name: "Xiaomi Redmi 13C", price: 12.0 },
      { device_name: "Huawei Nova 5T", price: 12.0 }
    ];

    for (const gp of gridPrices) {
      // Use INSERT IGNORE to avoid duplicates
      await conn.query(
        "INSERT IGNORE INTO grid_price (price, device_name) VALUES (?, ?)",
        [gp.price, gp.device_name]
      );
    }

    console.log("[Seed] ✅ Successfully inserted 5 sample grid prices");
  } catch (error) {
    console.error("[Seed] ⚠️ Failed to seed sample data:", error);
    // Don't throw - seeding is optional, don't break startup
  } finally {
    conn.release();
  }
}


