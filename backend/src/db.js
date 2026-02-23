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
    // Create device_registration table (dashboard-managed metadata)
    const registrationSql = `CREATE TABLE IF NOT EXISTS device_registration (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_device_name (device_name)
)`;
    await conn.query(registrationSql);
    console.log("Database schema initialized (device_registration table ready)");

    // Create device_state table (for Solar metrics and energy history)
    const deviceStateSql = `CREATE TABLE IF NOT EXISTS device_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(64) NOT NULL,
  energy_wh DECIMAL(12,3) NULL,
  battery_pct DECIMAL(5,1) NULL,
  ts TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_device_name (device_name),
  INDEX idx_ts (ts),
  INDEX idx_updated_at (updated_at)
)`;
    await conn.query(deviceStateSql);
    console.log("Database schema initialized (device_state table ready)");

    // Migration: Migrate data from old device table to new tables
    try {
      const [tables] = await conn.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device'"
      );
      
      if (tables.length > 0) {
        console.log("[Migration] Migrating data from device table to device_registration...");
        
        // Check if migration already done
        const [regCount] = await conn.query("SELECT COUNT(*) as count FROM device_registration");
        if (regCount[0].count === 0) {
          // Migrate device names to device_registration
          await conn.query(`
            INSERT INTO device_registration (device_name, created_at, updated_at)
            SELECT DISTINCT device_name, created_at, updated_at
            FROM device
            WHERE device_name IS NOT NULL AND device_name != ''
            ON DUPLICATE KEY UPDATE 
              updated_at = GREATEST(device_registration.updated_at, device.updated_at)
          `);
          console.log("[Migration] ✅ Migrated device names to device_registration");
        } else {
          console.log("[Migration] Migration already completed, skipping");
        }
      }
    } catch (migrationError) {
      console.log("[Migration] Note: Migration skipped (may already be complete):", migrationError.message);
    }

    // Migration: Ensure device_registration has one row per device_name (dedupe + UNIQUE)
    try {
      // 1) Deduplicate: keep one row per device_name (smallest id), delete the rest
      const [dupRows] = await conn.query(
        `SELECT device_name, COUNT(*) as cnt FROM device_registration GROUP BY device_name HAVING cnt > 1`
      );
      if (dupRows.length > 0) {
        console.log("[Migration] Deduplicating device_registration (one row per device_name)...");
        await conn.query(`
          DELETE r1 FROM device_registration r1
          INNER JOIN device_registration r2
          ON r1.device_name = r2.device_name AND r1.id > r2.id
        `);
        console.log("[Migration] ✅ Removed duplicate device_registration rows");
      }

      // 2) Add UNIQUE on device_name if not already present
      const [idxRows] = await conn.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_registration'
         AND COLUMN_NAME = 'device_name' AND NON_UNIQUE = 0
         LIMIT 1`
      );
      if (idxRows.length === 0) {
        console.log("[Migration] Adding UNIQUE index on device_registration.device_name...");
        await conn.query("ALTER TABLE device_registration ADD UNIQUE INDEX unique_device_name (device_name)");
        console.log("[Migration] ✅ unique_device_name index added");
      }
    } catch (migrationError) {
      console.log("[Migration] Note: device_registration UNIQUE migration skipped:", migrationError.message);
    }

    // Migration: Ensure device_state has one row per device_name (dedupe + UNIQUE)
    try {
      const [dupRows] = await conn.query(
        `SELECT device_name, COUNT(*) as cnt FROM device_state GROUP BY device_name HAVING cnt > 1`
      );
      if (dupRows.length > 0) {
        console.log("[Migration] Deduplicating device_state (one row per device_name, keeping latest)...");
        await conn.query(`
          DELETE s FROM device_state s
          INNER JOIN device_state s2 ON s.device_name = s2.device_name AND s.id < s2.id
        `);
        console.log("[Migration] ✅ Removed duplicate device_state rows");
      }

      const [idxRows] = await conn.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'device_state'
         AND COLUMN_NAME = 'device_name' AND NON_UNIQUE = 0
         LIMIT 1`
      );
      if (idxRows.length === 0) {
        console.log("[Migration] Adding UNIQUE index on device_state.device_name...");
        await conn.query("ALTER TABLE device_state ADD UNIQUE INDEX unique_device_name (device_name)");
        console.log("[Migration] ✅ device_state unique_device_name index added");
      }
    } catch (migrationError) {
      console.log("[Migration] Note: device_state UNIQUE migration skipped:", migrationError.message);
    }

    // Create grid_price table (device-independent)
    const gridPriceSql = `CREATE TABLE IF NOT EXISTS grid_price (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price DECIMAL(10,2) NOT NULL,
  estimated_savings DECIMAL(12,2) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at)
)`;
    await conn.query(gridPriceSql);
    console.log("Database schema initialized (grid_price table ready)");

    // Migration: Remove device_name column if it exists (for existing databases)
    try {
      const [columns] = await conn.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grid_price'"
      );
      const existingColumns = columns.map(c => c.COLUMN_NAME);
      
      // Remove device_name column and index if they exist
      if (existingColumns.includes('device_name')) {
        console.log("[Migration] Removing device_name column from grid_price table...");
        // Drop index first if it exists
        try {
          await conn.query("ALTER TABLE grid_price DROP INDEX idx_device_name");
        } catch (idxError) {
          // Index might not exist, that's okay
          console.log("[Migration] Note: idx_device_name index not found (may already be removed)");
        }
        // Drop column
        await conn.query("ALTER TABLE grid_price DROP COLUMN device_name");
        console.log("[Migration] ✅ device_name column removed from grid_price table");
      }
      
      // Add estimated_savings column if it doesn't exist
      if (!existingColumns.includes('estimated_savings')) {
        console.log("[Migration] Adding estimated_savings column to grid_price table...");
        await conn.query("ALTER TABLE grid_price ADD COLUMN estimated_savings DECIMAL(12,2) NULL AFTER price");
        console.log("[Migration] ✅ estimated_savings column added to grid_price table");
      }
    } catch (migrationError) {
      // Migration errors are non-fatal - table might not exist yet or column might already exist
      console.log("[Migration] Note: grid_price table migration skipped (may already exist):", migrationError.message);
    }
  } catch (error) {
    handleDatabaseError(error, "schema initialization");
    throw error;
  } finally {
    conn.release();
  }
}

// Seed sample Solar Unit data for testing/display purposes (device_name = Solar Name in this project)
export async function seedSampleDevices() {
  const conn = await pool.getConnection();
  try {
    // Check if device_registration table already has data
    const [existingRows] = await conn.query("SELECT COUNT(*) as count FROM device_registration");
    const existingCount = existingRows[0]?.count || 0;

    // Only seed if table is empty (or if explicitly enabled via env var)
    const forceSeed = process.env.SEED_SAMPLE_DATA === "true";
    if (existingCount > 0 && !forceSeed) {
      console.log(`[Seed] Device registration table already has ${existingCount} rows, skipping sample data`);
      return;
    }

    console.log("[Seed] Inserting sample Solar Unit entries...");

    const now = new Date();

    // Solar Unit data (device_name = Solar Name)
    const deviceData = [
      { device_name: "Solar Unit A", energy_wh: 1250.5, battery_pct: 85.5, ts: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000) },
      { device_name: "Solar Unit B", energy_wh: 980.3, battery_pct: 78.2, ts: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) },
      { device_name: "Solar Unit C", energy_wh: 2100.8, battery_pct: 92.0, ts: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
      { device_name: "Solar Unit D", energy_wh: 750.2, battery_pct: 72.5, ts: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) },
      { device_name: "Solar Unit E", energy_wh: 1100.6, battery_pct: 88.3, ts: new Date(now.getTime() - 0.5 * 24 * 60 * 60 * 1000) },
    ];

    for (const device of deviceData) {
      await conn.query(
        `INSERT INTO device_registration (device_name) 
         VALUES (?)
         ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
        [device.device_name]
      );
      await conn.query(
        `INSERT INTO device_state (device_name, energy_wh, battery_pct, ts) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           energy_wh = VALUES(energy_wh),
           battery_pct = VALUES(battery_pct),
           ts = VALUES(ts),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [device.device_name, device.energy_wh, device.battery_pct, device.ts]
      );
    }

    console.log("[Seed] ✅ Successfully registered sample Solar Units with state data");

    // Note: Grid prices are not auto-inserted - users must click "Estimate Savings" button to save grid prices
  } catch (error) {
    console.error("[Seed] ⚠️ Failed to seed sample data:", error);
    // Don't throw - seeding is optional, don't break startup
  } finally {
    conn.release();
  }
}


