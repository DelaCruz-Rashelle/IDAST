import mysql from "mysql2/promise";

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
    await conn.query(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        ts TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        device_name VARCHAR(64) NULL,

        top INT NULL,
        \`left\` INT NULL,
        \`right\` INT NULL,
        avg INT NULL,
        horizontal_error INT NULL,
        vertical_error INT NULL,

        tilt_angle INT NULL,
        pan_angle INT NULL,
        pan_target INT NULL,
        manual TINYINT(1) NULL,
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
      )
    `);
    console.log("Database schema initialized (telemetry table ready)");
  } catch (e) {
    console.error("Failed to initialize schema:", e);
    throw e;
  } finally {
    conn.release();
  }
}


