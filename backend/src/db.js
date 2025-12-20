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
    // Create device table (with all device-related display data)
    const deviceSql = `CREATE TABLE IF NOT EXISTS device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(64) NOT NULL UNIQUE,
  energy_wh DECIMAL(12,3) NULL,
  battery_pct DECIMAL(5,1) NULL,
  ts TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at),
  INDEX idx_ts (ts),
  INDEX idx_device_name (device_name)
)`;
    await conn.query(deviceSql);
    console.log("Database schema initialized (device table ready)");

    // Migration: Add new columns if they don't exist (for existing databases)
    try {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device'"
      );
      const existingColumns = columns.map(c => c.COLUMN_NAME);
      
      if (!existingColumns.includes('energy_wh')) {
        console.log("[Migration] Adding energy_wh column to device table...");
        await conn.query("ALTER TABLE device ADD COLUMN energy_wh DECIMAL(12,3) NULL AFTER device_name");
        console.log("[Migration] ✅ energy_wh column added");
      }
      
      if (!existingColumns.includes('battery_pct')) {
        console.log("[Migration] Adding battery_pct column to device table...");
        await conn.query("ALTER TABLE device ADD COLUMN battery_pct DECIMAL(5,1) NULL AFTER energy_wh");
        console.log("[Migration] ✅ battery_pct column added");
      }
      
      if (!existingColumns.includes('ts')) {
        console.log("[Migration] Adding ts column to device table...");
        await conn.query("ALTER TABLE device ADD COLUMN ts TIMESTAMP(3) NULL AFTER battery_pct");
        await conn.query("ALTER TABLE device ADD INDEX idx_ts (ts)");
        console.log("[Migration] ✅ ts column added");
      }

      // Update device_name length if needed
      const [deviceNameCol] = await conn.query(
        "SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device' AND COLUMN_NAME = 'device_name'"
      );
      if (deviceNameCol.length > 0 && deviceNameCol[0].CHARACTER_MAXIMUM_LENGTH < 64) {
        console.log("[Migration] Expanding device_name column length...");
        await conn.query("ALTER TABLE device MODIFY COLUMN device_name VARCHAR(64) NOT NULL");
        console.log("[Migration] ✅ device_name column expanded");
      }

      // Add unique constraint on device_name if it doesn't exist
      const [constraints] = await conn.query(
        "SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device' AND CONSTRAINT_TYPE = 'UNIQUE' AND CONSTRAINT_NAME LIKE '%device_name%'"
      );
      if (constraints.length === 0) {
        console.log("[Migration] Adding unique constraint on device_name...");
        // First, remove duplicates if any exist
        await conn.query(`
          DELETE d1 FROM device d1
          INNER JOIN device d2 
          WHERE d1.id > d2.id AND d1.device_name = d2.device_name
        `);
        await conn.query("ALTER TABLE device ADD UNIQUE KEY uk_device_name (device_name)");
        console.log("[Migration] ✅ unique constraint on device_name added");
      }

      // Add index for device_name if it doesn't exist (separate from unique constraint)
      const [indexes] = await conn.query(
        "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device' AND INDEX_NAME = 'idx_device_name'"
      );
      if (indexes.length === 0) {
        console.log("[Migration] Adding idx_device_name index...");
        await conn.query("ALTER TABLE device ADD INDEX idx_device_name (device_name)");
        console.log("[Migration] ✅ idx_device_name index added");
      }
    } catch (migrationError) {
      console.log("[Migration] Note: Device table migration skipped (may already be up to date)");
    }

    // Create grid_price table (with device connection)
    const gridPriceSql = `CREATE TABLE IF NOT EXISTS grid_price (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price DECIMAL(10,2) NOT NULL,
  device_name VARCHAR(64) NULL,
  estimated_savings DECIMAL(12,2) NULL,
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
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grid_price'"
      );
      const existingColumns = columns.map(c => c.COLUMN_NAME);
      
      if (!existingColumns.includes('device_name')) {
        console.log("[Migration] Adding device_name column to grid_price table...");
        await conn.query("ALTER TABLE grid_price ADD COLUMN device_name VARCHAR(64) NULL AFTER price");
        await conn.query("ALTER TABLE grid_price ADD INDEX idx_device_name (device_name)");
        console.log("[Migration] ✅ device_name column added to grid_price table");
      }
      
      if (!existingColumns.includes('estimated_savings')) {
        console.log("[Migration] Adding estimated_savings column to grid_price table...");
        await conn.query("ALTER TABLE grid_price ADD COLUMN estimated_savings DECIMAL(12,2) NULL AFTER device_name");
        console.log("[Migration] ✅ estimated_savings column added to grid_price table");
      }
    } catch (migrationError) {
      // Migration errors are non-fatal - table might not exist yet or column might already exist
      console.log("[Migration] Note: grid_price table migration skipped (may already exist)");
    }
  } catch (error) {
    handleDatabaseError(error, "schema initialization");
    throw error;
  } finally {
    conn.release();
  }
}

// Seed sample device data for testing/display purposes
export async function seedSampleDevices() {
  const conn = await pool.getConnection();
  try {
    // Check if device table already has data
    const [existingRows] = await conn.query("SELECT COUNT(*) as count FROM device");
    const existingCount = existingRows[0]?.count || 0;
    
    // Only seed if table is empty (or if explicitly enabled via env var)
    const forceSeed = process.env.SEED_SAMPLE_DATA === "true";
    if (existingCount > 0 && !forceSeed) {
      console.log(`[Seed] Device table already has ${existingCount} rows, skipping sample data`);
      return;
    }

    console.log("[Seed] Inserting 5 sample device entries...");

    // Get current time and create timestamps for the last 5 days
    const now = new Date();

    // Insert device data into device table with all necessary fields
    const deviceData = [
      {
        device_name: "iPhone 15 Pro",
        energy_wh: 1250.5,
        battery_pct: 85.5,
        ts: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      },
      {
        device_name: "iPhone 14",
        energy_wh: 980.3,
        battery_pct: 78.2,
        ts: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      },
      {
        device_name: "Infinix Hot 50 Pro Plus",
        energy_wh: 2100.8,
        battery_pct: 92.0,
        ts: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      },
      {
        device_name: "Xiaomi Redmi 13C",
        energy_wh: 750.2,
        battery_pct: 72.5,
        ts: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      },
      {
        device_name: "Huawei Nova 5T",
        energy_wh: 1100.6,
        battery_pct: 88.3,
        ts: new Date(now.getTime() - 0.5 * 24 * 60 * 60 * 1000), // 12 hours ago
      },
    ];

    for (const device of deviceData) {
      // Use INSERT ... ON DUPLICATE KEY UPDATE to update existing devices or insert new ones
      await conn.query(
        `INSERT INTO device (device_name, energy_wh, battery_pct, ts) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           energy_wh = VALUES(energy_wh),
           battery_pct = VALUES(battery_pct),
           ts = VALUES(ts),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [device.device_name, device.energy_wh, device.battery_pct, device.ts]
      );
    }

    console.log("[Seed] ✅ Successfully registered 5 sample devices with energy, battery, and timestamp data");

    // Insert sample grid prices for each device (with different prices per device)
    const gridPrices = [
      { device_name: "iPhone 15 Pro", price: 15.5 },
      { device_name: "iPhone 14", price: 14.2 },
      { device_name: "Infinix Hot 50 Pro Plus", price: 11.8 },
      { device_name: "Xiaomi Redmi 13C", price: 10.5 },
      { device_name: "Huawei Nova 5T", price: 13.0 }
    ];

    for (const gp of gridPrices) {
      // Calculate estimated savings for this specific device
      let estimatedSavings = null;
      try {
        const [energyRows] = await conn.query(
          "SELECT COALESCE(SUM(energy_wh), 0) as total_energy_wh FROM device WHERE device_name = ? AND energy_wh IS NOT NULL",
          [gp.device_name]
        );
        const totalEnergyWh = energyRows?.[0]?.total_energy_wh 
          ? Number(energyRows[0].total_energy_wh) 
          : 0;
        const totalEnergyKWh = totalEnergyWh / 1000; // Convert Wh to kWh
        estimatedSavings = totalEnergyKWh * gp.price;
      } catch (calcError) {
        console.log(`[Seed] Could not calculate estimated savings for ${gp.device_name}:`, calcError.message);
      }
      
      // Use INSERT IGNORE to avoid duplicates
      await conn.query(
        "INSERT IGNORE INTO grid_price (price, device_name, estimated_savings) VALUES (?, ?, ?)",
        [gp.price, gp.device_name, estimatedSavings]
      );
    }

    console.log("[Seed] ✅ Successfully inserted 5 sample grid prices with different prices per device");
  } catch (error) {
    console.error("[Seed] ⚠️ Failed to seed sample data:", error);
    // Don't throw - seeding is optional, don't break startup
  } finally {
    conn.release();
  }
}


