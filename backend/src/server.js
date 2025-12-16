import express from "express";
import { dbPing, initSchema } from "./db.js";
import { startIngestLoop } from "./ingest.js";
import { pool } from "./db.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Basic CORS for Vercel dashboard -> Railway API calls
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/health", async (req, res) => {
  try {
    await dbPing();
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Very small status endpoint to confirm env wiring in Railway.
app.get("/", (req, res) => {
  res.type("text/plain").send("IDAST telemetry backend running");
});

app.get("/api/latest", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM telemetry ORDER BY ts DESC, id DESC LIMIT 1"
    );
    const row = rows?.[0] || null;
    return res.json({ ok: true, data: row });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// CSV endpoint compatible with the dashboard's existing history parser:
// "timestamp,energy_wh,battery_pct,device_name,session_min"
// - timestamp is unix seconds
// - energy_wh is daily energy (best-effort)
app.get("/api/history.csv", async (req, res) => {
  try {
    let days = req.query.days ? Number(req.query.days) : 60;
    if (!Number.isFinite(days) || days <= 0) days = 60;
    days = Math.min(days, 365);

    const [rows] = await pool.query(
      `
      SELECT
        UNIX_TIMESTAMP(DATE(ts)) AS day_ts_s,
        MIN(energy_wh) AS min_energy_wh,
        MAX(energy_wh) AS max_energy_wh,
        AVG(battery_pct) AS avg_battery_pct,
        SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(device_name,'Unknown') ORDER BY ts DESC SEPARATOR ','), ',', 1) AS last_device_name,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts
      FROM telemetry
      WHERE ts >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(ts)
      ORDER BY DATE(ts) ASC
      `,
      [days]
    );

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
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Query stored telemetry rows for charts/reports.
// Params:
// - from: ISO date/time (optional, default: last 24h)
// - to: ISO date/time (optional, default: now)
// - limit: max rows (optional, default: 5000, max: 20000)
app.get("/api/telemetry", async (req, res) => {
  try {
    const now = new Date();
    const to = req.query.to ? new Date(String(req.query.to)) : now;
    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(to.getTime() - 24 * 3600 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ ok: false, error: "Invalid from/to" });
    }

    let limit = req.query.limit ? Number(req.query.limit) : 5000;
    if (!Number.isFinite(limit) || limit <= 0) limit = 5000;
    limit = Math.min(limit, 20000);

    const [rows] = await pool.query(
      "SELECT * FROM telemetry WHERE ts BETWEEN ? AND ? ORDER BY ts ASC, id ASC LIMIT ?",
      [from, to, limit]
    );

    return res.json({ ok: true, from, to, count: rows.length, data: rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Initialize database schema before starting server
async function startServer() {
  try {
    await initSchema();
  } catch (e) {
    console.error("Schema initialization failed:", e);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
  });

  return server;
}

const server = await startServer();

// Start ingestion loop unless explicitly disabled
if (process.env.INGEST_ENABLED !== "false") {
  startIngestLoop({ logger: console });
} else {
  console.log("INGEST_ENABLED=false; ingest loop disabled");
}

function shutdown() {
  console.log("Shutting down...");
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);