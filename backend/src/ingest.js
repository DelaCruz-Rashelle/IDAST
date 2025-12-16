import { pool } from "./db.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getTunnelBaseUrl() {
  const base = process.env.TUNNEL_BASE_URL;
  if (!base) throw new Error("Missing required env var: TUNNEL_BASE_URL");
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

export function getIngestIntervalMs() {
  const v = process.env.INGEST_INTERVAL_MS ? Number(process.env.INGEST_INTERVAL_MS) : 10_000;
  if (!Number.isFinite(v) || v < 1000) return 10_000;
  return v;
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

export async function fetchEsp32Telemetry() {
  const url = `${getTunnelBaseUrl()}/data`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Tunnel fetch failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json || typeof json !== "object") throw new Error("Invalid JSON from ESP32 /data");
  return json;
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

  await pool.execute(sql, params);
}

export function startIngestLoop({ logger = console } = {}) {
  const intervalMs = getIngestIntervalMs();
  logger.log(`Ingest loop starting: every ${intervalMs}ms`);

  let running = true;
  let inFlight = false;

  const tick = async () => {
    if (!running || inFlight) return;
    inFlight = true;
    try {
      const t = await fetchEsp32Telemetry();
      await insertTelemetryRow(t);
    } catch (err) {
      logger.error("Ingest tick failed:", err?.message || err);
      // simple backoff: wait 2s before allowing next tick
      await sleep(2000);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  // run immediately on startup
  tick().catch(() => {});

  return () => {
    running = false;
    clearInterval(timer);
  };
}


