import express from "express";
import { dbPing, initSchema, seedSampleDevices } from "./db.js";
import { startIngestLoop } from "./ingest.js";
import { pool } from "./db.js";
import { asyncHandler, createErrorResponse, handleDatabaseError } from "./errorHandler.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS configuration - allow all origins by default, or restrict to ALLOWED_ORIGINS if set
app.use((req, res, next) => {
  // Get allowed origins from environment variable (comma-separated)
  // If ALLOWED_ORIGINS is not set, allow all origins (*) for development/convenience
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim())
    : null; // null means allow all origins
  
  const origin = req.headers.origin;
  
  if (allowedOrigins === null) {
    // Allow all origins (development/default behavior)
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    // Restrict to specific origins (production/security)
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else if (origin) {
      // Origin not allowed - log for security monitoring
      console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
    }
  }
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  next();
});

app.get("/health", asyncHandler(async (req, res) => {
  await dbPing();
  return res.json({ ok: true });
}, "HealthCheck"));

// Very small status endpoint to confirm env wiring in Railway.
app.get("/", (req, res) => {
  res.type("text/plain").send("IDAST device data backend running");
});

app.get("/api/latest", asyncHandler(async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        r.id,
        r.device_name,
        s.energy_wh,
        s.battery_pct,
        s.ts,
        r.created_at,
        s.updated_at
       FROM device_registration r
       LEFT JOIN device_state s ON r.device_name = s.device_name
       ORDER BY s.ts DESC, s.updated_at DESC, r.id DESC 
       LIMIT 1`
    );
    const row = rows?.[0] || null;
    return res.json({ ok: true, data: row });
  } catch (error) {
    handleDatabaseError(error, "latest query");
    throw error; // Re-throw to be caught by asyncHandler
  }
}, "API"));

// CSV endpoint compatible with the dashboard's existing history parser:
// "timestamp,energy_wh,battery_pct,device_name,session_min"
// - timestamp is unix seconds
// - energy_wh is daily energy (best-effort)
app.get("/api/history.csv", asyncHandler(async (req, res) => {
  let days = req.query.days ? Number(req.query.days) : 60;
  if (!Number.isFinite(days) || days <= 0) days = 60;
  days = Math.min(days, 365);

  console.log(`[history.csv] Querying device history for ${days} days`);
  console.log(`[history.csv] Request origin: ${req.headers.origin || 'none'}`);
  
  // First, verify database connection
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
    console.log(`[history.csv] Database connection verified`);
  } catch (connErr) {
    conn.release();
    console.error(`[history.csv] Database connection failed:`, connErr);
    handleDatabaseError(connErr, "connection check");
    throw new Error(`Database connection failed: ${connErr?.message || String(connErr)}`);
  }
  
    try {
      // Fetch from device_state table, grouped by day
      const [rows] = await conn.query(
      `
      SELECT
        UNIX_TIMESTAMP(day_date) AS day_ts_s,
        SUM(energy_wh) AS total_energy_wh,
        AVG(battery_pct) AS avg_battery_pct,
        GROUP_CONCAT(DISTINCT device_name ORDER BY device_name SEPARATOR ', ') AS device_names,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts,
        COUNT(*) AS device_count
      FROM (
        SELECT 
          DATE(COALESCE(ts, updated_at)) AS day_date,
          ts,
          energy_wh,
          battery_pct,
          device_name
        FROM device_state
        WHERE COALESCE(ts, updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND device_name IS NOT NULL
          AND device_name != ''
      ) AS daily_data
      GROUP BY day_date
      ORDER BY day_date ASC
      `,
      [days]
    );
    
    console.log(`[history.csv] Query returned ${rows.length} rows from device_state table`);
    
    const lines = [];
    lines.push("timestamp,energy_wh,battery_pct,device_name,session_min");
    
    if (rows.length === 0) {
      console.log(`[history.csv] No data found, returning empty CSV with headers`);
    }
    
    for (const r of rows) {
      const dayTs = Number(r.day_ts_s) || 0;
      const energyWh = r.total_energy_wh !== null && r.total_energy_wh !== undefined 
        ? Number(r.total_energy_wh) 
        : "";
      const batt = r.avg_battery_pct !== null && r.avg_battery_pct !== undefined 
        ? Number(r.avg_battery_pct).toFixed(1) 
        : "";
      // Use first device name if multiple devices on same day, or "Multiple" if many
      const dev = r.device_names 
        ? (r.device_count > 3 ? "Multiple Devices" : r.device_names.split(',')[0].trim())
        : "Unknown";
      const safeDev = dev.replaceAll(",", " ");

      // best-effort session minutes for display (not used by dashboard charts)
      const first = r.first_ts ? new Date(r.first_ts).getTime() : null;
      const last = r.last_ts ? new Date(r.last_ts).getTime() : null;
      const sessionMin =
        first && last && last >= first ? Math.round((last - first) / 60000) : "";

      lines.push(`${dayTs},${energyWh},${batt},${safeDev},${sessionMin}`);
    }

    const csvContent = lines.join("\n") + "\n";
    console.log(`[history.csv] Returning CSV with ${lines.length - 1} data rows (plus header)`);
    
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error(`[history.csv] Error processing request:`, error);
    throw error;
  } finally {
    conn.release();
  }
}, "HistoryCSV"));

// Query stored device rows for charts/reports.
// Note: Endpoint name kept as /api/telemetry for backward compatibility
// but it now queries the device table instead of telemetry table.
// Params:
// - from: ISO date/time (optional, default: last 24h)
// - to: ISO date/time (optional, default: now)
// - limit: max rows (optional, default: 5000, max: 20000)
app.get("/api/telemetry", asyncHandler(async (req, res) => {
  const now = new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : now;
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 24 * 3600 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const error = new Error("Invalid from/to date parameters");
    error.statusCode = 400;
    throw error;
  }

  let limit = req.query.limit ? Number(req.query.limit) : 5000;
  if (!Number.isFinite(limit) || limit <= 0) limit = 5000;
  limit = Math.min(limit, 20000);

  try {
    const [rows] = await pool.query(
      `SELECT * FROM device_state 
       WHERE COALESCE(ts, updated_at) BETWEEN ? AND ? 
       ORDER BY COALESCE(ts, updated_at) ASC 
       LIMIT ?`,
      [from, to, limit]
    );

    return res.json({ ok: true, from, to, count: rows.length, data: rows });
  } catch (error) {
    handleDatabaseError(error, "device state query");
    throw error; // Re-throw to be caught by asyncHandler
  }
}, "API"));

// Device endpoints: save and retrieve device data
app.post("/api/device", asyncHandler(async (req, res) => {
  const { device_name } = req.body;
  
  if (!device_name || typeof device_name !== "string") {
    const error = new Error("device_name is required and must be a string");
    error.statusCode = 400;
    throw error;
  }
  
  if (device_name.length > 64) {
    const error = new Error("device_name must be 64 characters or less");
    error.statusCode = 400;
    throw error;
  }
  
  try {
    // Insert or update device registration (dashboard-managed)
    const [result] = await pool.query(
      `INSERT INTO device_registration (device_name) 
       VALUES (?)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
      [device_name.trim()]
    );
    
    const deviceId = result.insertId || (result.affectedRows > 0 ? result.insertId : null);
    return res.json({ 
      ok: true, 
      id: deviceId, 
      device_name: device_name.trim()
    });
  } catch (error) {
    handleDatabaseError(error, "device registration insert");
    throw error;
  }
}, "API"));

app.get("/api/device", asyncHandler(async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        r.device_name,
        s.energy_wh,
        s.battery_pct,
        s.ts
       FROM device_registration r
       LEFT JOIN device_state s ON r.device_name = s.device_name
       ORDER BY s.updated_at DESC, r.updated_at DESC, r.id DESC 
       LIMIT 1`
    );
    const device = rows?.[0] || null;
    return res.json({ 
      ok: true, 
      device_name: device?.device_name || null,
      energy_wh: device?.energy_wh !== null && device?.energy_wh !== undefined ? Number(device.energy_wh) : null,
      battery_pct: device?.battery_pct !== null && device?.battery_pct !== undefined ? Number(device.battery_pct) : null,
      ts: device?.ts || null
    });
  } catch (error) {
    handleDatabaseError(error, "device query");
    throw error;
  }
}, "API"));

// Device state endpoint: save device state manually (dashboard-managed)
app.post("/api/device-state", asyncHandler(async (req, res) => {
  const { device_name, energy_wh, battery_pct, ts } = req.body;
  
  if (!device_name || typeof device_name !== "string") {
    const error = new Error("device_name is required and must be a string");
    error.statusCode = 400;
    throw error;
  }
  
  if (device_name.length > 64) {
    const error = new Error("device_name must be 64 characters or less");
    error.statusCode = 400;
    throw error;
  }

  // Validate optional fields
  const energyWh = energy_wh !== undefined && energy_wh !== null ? Number(energy_wh) : null;
  const batteryPct = battery_pct !== undefined && battery_pct !== null ? Number(battery_pct) : null;
  const timestamp = ts ? new Date(ts) : (energyWh !== null || batteryPct !== null ? new Date() : null);

  if (energyWh !== null && (!Number.isFinite(energyWh) || energyWh < 0)) {
    const error = new Error("energy_wh must be a non-negative number");
    error.statusCode = 400;
    throw error;
  }

  if (batteryPct !== null && (!Number.isFinite(batteryPct) || batteryPct < 0 || batteryPct > 100)) {
    const error = new Error("battery_pct must be a number between 0 and 100");
    error.statusCode = 400;
    throw error;
  }

  if (timestamp && Number.isNaN(timestamp.getTime())) {
    const error = new Error("ts must be a valid date");
    error.statusCode = 400;
    throw error;
  }
  
  try {
    // Ensure device exists in device_registration first
    await pool.query(
      `INSERT INTO device_registration (device_name) 
       VALUES (?)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
      [device_name.trim()]
    );
    
    // Insert or update device state
    const [result] = await pool.query(
      `INSERT INTO device_state (device_name, energy_wh, battery_pct, ts) 
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         energy_wh = COALESCE(VALUES(energy_wh), energy_wh),
         battery_pct = COALESCE(VALUES(battery_pct), battery_pct),
         ts = COALESCE(VALUES(ts), ts),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [device_name.trim(), energyWh, batteryPct, timestamp]
    );
    
    return res.json({ 
      ok: true, 
      device_name: device_name.trim(),
      energy_wh: energyWh,
      battery_pct: batteryPct,
      ts: timestamp
    });
  } catch (error) {
    handleDatabaseError(error, "device state insert");
    throw error;
  }
}, "API"));

// Get all registered devices with their data
app.get("/api/devices", asyncHandler(async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        r.device_name,
        s.energy_wh,
        s.battery_pct,
        s.ts,
        UNIX_TIMESTAMP(s.ts) as ts_unix,
        r.created_at,
        r.updated_at as registration_updated_at,
        s.updated_at as state_updated_at
       FROM device_registration r
       LEFT JOIN device_state s ON r.device_name = s.device_name
       ORDER BY r.device_name ASC`
    );
    const devices = rows.map(row => ({
      device_name: row.device_name,
      energy_wh: row.energy_wh !== null && row.energy_wh !== undefined ? Number(row.energy_wh) : null,
      battery_pct: row.battery_pct !== null && row.battery_pct !== undefined ? Number(row.battery_pct) : null,
      ts: row.ts,
      ts_unix: row.ts_unix ? Number(row.ts_unix) : null,
      created_at: row.created_at,
      updated_at: row.state_updated_at || row.registration_updated_at
    }));
    return res.json({ ok: true, devices });
  } catch (error) {
    handleDatabaseError(error, "devices query");
    throw error;
  }
}, "API"));

// Get device statistics for Monthly Report (last 60 days)
// Note: Device table stores latest state per device, so we use the latest energy values
app.get("/api/device-stats", asyncHandler(async (req, res) => {
  try {
    let days = req.query.days ? Number(req.query.days) : 60;
    if (!Number.isFinite(days) || days <= 0) days = 60;
    days = Math.min(days, 365);

    // Get all devices with energy data from device_state
    const [rows] = await pool.query(
      `
      SELECT 
        device_name,
        energy_wh,
        battery_pct,
        COALESCE(ts, updated_at) AS last_update,
        UNIX_TIMESTAMP(COALESCE(ts, updated_at)) AS last_update_unix
      FROM device_state
      WHERE device_name IS NOT NULL
        AND device_name != ''
        AND energy_wh IS NOT NULL
        AND energy_wh > 0
      ORDER BY energy_wh DESC
      `
    );

    const stats = rows.map(row => ({
      name: row.device_name,
      totalEnergyWh: row.energy_wh !== null ? Number(row.energy_wh) : 0,
      totalEnergyKWh: row.energy_wh !== null ? Number(row.energy_wh) / 1000.0 : 0,
      avgBattery: row.battery_pct !== null ? Number(row.battery_pct) : 0,
      sessionCount: 1, // Each device record represents one session
      firstSeen: row.last_update_unix ? Number(row.last_update_unix) : 0,
      lastSeen: row.last_update_unix ? Number(row.last_update_unix) : 0
    }));

    // Calculate total energy across all devices
    const totalEnergyWh = stats.reduce((sum, stat) => sum + stat.totalEnergyWh, 0);
    const totalEnergyKWh = totalEnergyWh / 1000.0;

    // Count total days with data (based on when devices were updated)
    // For devices with data, count distinct days
    const [dayCountRows] = await pool.query(
      `
      SELECT COUNT(DISTINCT DATE(COALESCE(ts, updated_at))) AS day_count
      FROM device_state
      WHERE device_name IS NOT NULL
        AND device_name != ''
        AND energy_wh IS NOT NULL
        AND energy_wh > 0
        AND COALESCE(ts, updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `,
      [days]
    );
    const dayCount = dayCountRows[0]?.day_count ? Number(dayCountRows[0].day_count) : (stats.length > 0 ? 1 : 0);
    const avgPerDay = dayCount > 0 ? totalEnergyKWh / dayCount : (stats.length > 0 ? totalEnergyKWh : 0);

    console.log(`[device-stats] Returning ${stats.length} devices, totalEnergyKWh: ${totalEnergyKWh.toFixed(3)}, avgPerDay: ${avgPerDay.toFixed(3)}, dayCount: ${dayCount}`);
    if (stats.length > 0) {
      console.log(`[device-stats] Device names:`, stats.map(s => s.name).join(", "));
    }

    return res.json({
      ok: true,
      totalEnergyKWh,
      totalEnergyWh,
      avgPerDay,
      dayCount,
      deviceStats: stats
    });
  } catch (error) {
    handleDatabaseError(error, "device stats query");
    throw error;
  }
}, "API"));

// Grid price endpoints: save and retrieve grid price
app.post("/api/grid-price", asyncHandler(async (req, res) => {
  const { price } = req.body;
  
  if (price === undefined || price === null) {
    const error = new Error("price is required");
    error.statusCode = 400;
    throw error;
  }
  
  const priceNum = Number(price);
  if (!Number.isFinite(priceNum) || priceNum <= 0 || priceNum >= 1000) {
    const error = new Error("price must be a number between 0 and 1000");
    error.statusCode = 400;
    throw error;
  }
  
  try {
    // Calculate total energy from device_state table to estimate savings
    // Calculate savings for all devices (device-independent)
    let estimatedSavings = null;
    try {
      const [energyRows] = await pool.query(
        "SELECT COALESCE(SUM(energy_wh), 0) as total_energy_wh FROM device_state WHERE energy_wh IS NOT NULL"
      );
      const totalEnergyWh = energyRows?.[0]?.total_energy_wh 
        ? Number(energyRows[0].total_energy_wh) 
        : 0;
      const totalEnergyKWh = totalEnergyWh / 1000; // Convert Wh to kWh
      estimatedSavings = totalEnergyKWh * priceNum;
    } catch (calcError) {
      console.log("[Grid Price] Could not calculate estimated savings:", calcError.message);
      // Continue without estimated savings if calculation fails
    }
    
    // Insert new grid price record (device-independent)
    const [result] = await pool.query(
      "INSERT INTO grid_price (price, estimated_savings) VALUES (?, ?)",
      [priceNum, estimatedSavings]
    );
    
    return res.json({ 
      ok: true, 
      id: result.insertId, 
      price: priceNum, 
      estimated_savings: estimatedSavings !== null ? Number(estimatedSavings.toFixed(2)) : null
    });
  } catch (error) {
    handleDatabaseError(error, "grid_price insert");
    throw error;
  }
}, "API"));

app.get("/api/grid-price", asyncHandler(async (req, res) => {
  try {
    // Get most recent grid price (device-independent)
    const [rows] = await pool.query(
      "SELECT price, estimated_savings FROM grid_price ORDER BY updated_at DESC, id DESC LIMIT 1"
    );
    const price = rows?.[0]?.price !== null && rows?.[0]?.price !== undefined 
      ? Number(rows[0].price) 
      : null;
    const estimatedSavings = rows?.[0]?.estimated_savings !== null && rows?.[0]?.estimated_savings !== undefined
      ? Number(rows[0].estimated_savings)
      : null;
    
    return res.json({ ok: true, price, estimated_savings: estimatedSavings });
  } catch (error) {
    handleDatabaseError(error, "grid_price query");
    throw error;
  }
}, "API"));

// History logs endpoint: returns both device_state and grid_price history
app.get("/api/history-logs", asyncHandler(async (req, res) => {
  try {
    let limit = req.query.limit ? Number(req.query.limit) : 100;
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    limit = Math.min(limit, 1000); // Max 1000 records
    
    // Fetch device_state history
    const [deviceStateRows] = await pool.query(
      `SELECT 
        id,
        device_name,
        energy_wh,
        battery_pct,
        ts,
        updated_at
       FROM device_state 
       ORDER BY updated_at DESC, id DESC 
       LIMIT ?`,
      [limit]
    );
    
    // Fetch grid_price history
    const [gridPriceRows] = await pool.query(
      `SELECT 
        id,
        price,
        estimated_savings,
        created_at,
        updated_at
       FROM grid_price 
       ORDER BY updated_at DESC, id DESC 
       LIMIT ?`,
      [limit]
    );
    
    return res.json({ 
      ok: true, 
      device_states: deviceStateRows || [],
      grid_prices: gridPriceRows || []
    });
  } catch (error) {
    handleDatabaseError(error, "history logs query");
    throw error;
  }
}, "API"));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Initialize database schema before starting server
async function startServer() {
  try {
    await initSchema();
    // Seed sample data if table is empty (or if SEED_SAMPLE_DATA=true)
    await seedSampleDevices();
  } catch (error) {
    handleDatabaseError(error, "schema initialization");
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

  return server;
}

const server = await startServer();

// Start MQTT ingestion loop unless explicitly disabled
if (process.env.INGEST_ENABLED !== "false") {
  try {
    startIngestLoop({ logger: console });
  } catch (error) {
    const errorResponse = createErrorResponse(error, "MQTT_Ingest");
    console.error("Failed to start MQTT ingest loop:", errorResponse.error);
    console.error("Make sure MQTT_BROKER_URL is set in environment variables");
  }
} else {
  console.log("INGEST_ENABLED=false; MQTT ingest loop disabled");
}

function shutdown() {
  console.log("Shutting down...");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);