import express from "express";
import { dbPing, initSchema } from "./db.js";
import { startIngestLoop } from "./ingest.js";
import { pool } from "./db.js";
import { asyncHandler, createErrorResponse, handleDatabaseError } from "./errorHandler.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS configuration - restrict to allowed origins only
app.use((req, res, next) => {
  // Get allowed origins from environment variable (comma-separated)
  // Default to empty array if not set (no origins allowed)
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(origin => origin.trim())
    : [];
  
  const origin = req.headers.origin;
  
  // Allow requests with matching origin
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else if (origin) {
    // Origin not allowed - log for security monitoring
    console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
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
  res.type("text/plain").send("IDAST telemetry backend running");
});

app.get("/api/latest", asyncHandler(async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM telemetry ORDER BY ts DESC, id DESC LIMIT 1"
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

  console.log(`[history.csv] Querying history for ${days} days`);
  
  // First, verify database connection and set GROUP_CONCAT max length to avoid truncation
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
    // Increase GROUP_CONCAT max length to avoid truncation errors
    await conn.query("SET SESSION group_concat_max_len = 10000");
  } catch (connErr) {
    conn.release();
    handleDatabaseError(connErr, "connection check");
    throw new Error(`Database connection failed: ${connErr?.message || String(connErr)}`);
  }
  
  try {
    const [rows] = await conn.query(
      `
      SELECT
        UNIX_TIMESTAMP(day_date) AS day_ts_s,
        MIN(energy_wh) AS min_energy_wh,
        MAX(energy_wh) AS max_energy_wh,
        AVG(battery_pct) AS avg_battery_pct,
        COALESCE(
          (SELECT device_name 
           FROM telemetry t2 
           WHERE DATE(t2.ts) = day_date
             AND t2.device_name IS NOT NULL 
             AND t2.device_name != ''
           ORDER BY t2.ts DESC, t2.id DESC 
           LIMIT 1),
          'Unknown'
        ) AS last_device_name,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts
      FROM (
        SELECT 
          DATE(ts) AS day_date,
          ts,
          energy_wh,
          battery_pct
        FROM telemetry
        WHERE ts >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ) AS daily_data
      GROUP BY day_date
      ORDER BY day_date ASC
      `,
      [days]
    );
    
    console.log(`[history.csv] Query returned ${rows.length} rows`);
    
    const lines = [];
    lines.push("timestamp,energy_wh,battery_pct,device_name,session_min");
    for (const r of rows) {
      const dayTs = Number(r.day_ts_s) || 0;
      const minE = r.min_energy_wh === null ? null : Number(r.min_energy_wh);
      const maxE = r.max_energy_wh === null ? null : Number(r.max_energy_wh);
      let energyWh = null;
      if (Number.isFinite(minE) && Number.isFinite(maxE)) {
        energyWh = Math.max(0, maxE - minE);
      }
      const batt = r.avg_battery_pct === null ? "" : Number(r.avg_battery_pct).toFixed(1);
      const dev = (r.last_device_name || "Unknown").replaceAll(",", " ");

      // best-effort session minutes for display (not used by dashboard charts)
      const first = r.first_ts ? new Date(r.first_ts).getTime() : null;
      const last = r.last_ts ? new Date(r.last_ts).getTime() : null;
      const sessionMin =
        first && last && last >= first ? Math.round((last - first) / 60000) : "";

      lines.push(`${dayTs},${energyWh ?? ""},${batt},${dev},${sessionMin}`);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.status(200).send(lines.join("\n") + "\n");
  } finally {
    conn.release();
  }
}, "HistoryCSV"));

// Query stored telemetry rows for charts/reports.
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
      "SELECT * FROM telemetry WHERE ts BETWEEN ? AND ? ORDER BY ts ASC, id ASC LIMIT ?",
      [from, to, limit]
    );

    return res.json({ ok: true, from, to, count: rows.length, data: rows });
  } catch (error) {
    handleDatabaseError(error, "telemetry query");
    throw error; // Re-throw to be caught by asyncHandler
  }
}, "API"));

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Initialize database schema before starting server
async function startServer() {
  try {
    await initSchema();
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