/**
 * Telemetry simulator — writes electrical points for `electrical` assets and
 * HVAC/environment points for their domains into `telemetry.point_values`, then
 * `pg_notify('bms_telemetry', …)` for the API WebSocket fan-out.
 */
import { config } from "dotenv";
import http from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import pg from "pg";
import promClient from "prom-client";

const require = createRequire(import.meta.url);
const {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} = require("@bms/shared");

const pkgRoot = process.cwd();
config({ path: resolve(pkgRoot, "../../apps/api/.env") });
config({ path: resolve(pkgRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const rateHz = Math.max(0.1, Number(process.env.SIM_RATE_HZ ?? "1"));
const intervalMs = 1000 / rateHz;
const assetCountRaw = String(process.env.SIM_ASSET_COUNT ?? "64").trim().toLowerCase();
const assetLimit =
  assetCountRaw === "all"
    ? null
    : Math.min(96, Math.max(1, Number(assetCountRaw)));
const metricsPort = Number(process.env.SIM_METRICS_PORT ?? "9101");

const NOTIFY_CHANNEL = "bms_telemetry";

/** PostgreSQL limits NOTIFY payload to ~8000 bytes; split batches for electrical + HVAC. */
const MAX_NOTIFY_UTF8_BYTES = 7000;

const pool = new pg.Pool({ connectionString: databaseUrl });

const metricsRegistry = new promClient.Registry();
metricsRegistry.setDefaultLabels({ service: "bms-sim" });
promClient.collectDefaultMetrics({
  prefix: "bms_sim_",
  register: metricsRegistry,
});
const ticksTotal = new promClient.Counter({
  name: "bms_sim_ticks_total",
  help: "Simulator ticks completed.",
  registers: [metricsRegistry],
});
const pointsWritten = new promClient.Counter({
  name: "bms_sim_points_written_total",
  help: "Telemetry points written by the simulator.",
  registers: [metricsRegistry],
});
const notifyChunks = new promClient.Counter({
  name: "bms_sim_notify_chunks_total",
  help: "Postgres NOTIFY chunks emitted by the simulator.",
  registers: [metricsRegistry],
});
const tickDuration = new promClient.Histogram({
  name: "bms_sim_tick_duration_seconds",
  help: "Simulator tick duration in seconds.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

/** @type {Map<string, { v: number, i: number, kw: number, pf: number }>} */
const elecState = new Map();

/** @type {Map<string, { supplyC: number, returnC: number, fanRpm: number, fanPct: number, chwSup: number, chwRet: number, flow: number, coolingKw: number, compressorOk: number }>} */
const hvacState = new Map();

/** @type {Map<string, { rackKw: number, rackTempC: number, utilPct: number, outletsUsed: number, pduAStatus: number, pduBStatus: number }>} */
const itState = new Map();

/** @type {Map<string, { tempC: number, humidityPct: number, leakState: number, smokeState: number }>} */
const environmentState = new Map();

function rndWalk(prev, delta, min, max) {
  const x = prev + (Math.random() * 2 - 1) * delta;
  return Math.min(max, Math.max(min, x));
}

function ensureElecState(assetId) {
  let s = elecState.get(assetId);
  if (!s) {
    s = {
      v: 228 + Math.random() * 8,
      i: 120 + Math.random() * 200,
      kw: 80 + Math.random() * 400,
      pf: 0.88 + Math.random() * 0.1,
    };
    elecState.set(assetId, s);
  }
  return s;
}

function crProfile(code) {
  const profiles = {
    "CR-UTILITY-11KV": { kw: 4.8, current: 15, breaker: 1 },
    "CR-XFMR-100KVA": { kw: 4.6, current: 14, breaker: 1 },
    "CR-MAIN-BUS": { kw: 4.4, current: 13.8, breaker: 1 },
    "CR-UPS-OUT-BUS": { kw: 4.2, current: 13.2, breaker: 1 },
    "CR-Q1": { kw: 4.21, current: 13.6, breaker: 1 },
    "CR-Q2": { kw: 2.61, current: 7.4, breaker: 1 },
    "CR-Q3": { kw: 2.01, current: 5.6, breaker: 1 },
    "CR-Q4": { kw: 1.74, current: 8.1, breaker: 1 },
    "CR-Q5": { kw: 1.3, current: 5.9, breaker: 1 },
    "CR-Q6": { kw: 1.4, current: 6.2, breaker: 1 },
    "CR-Q7": { kw: 1.41, current: 6.4, breaker: 1 },
    "CR-Q8": { kw: 0.81, current: 3.6, breaker: 1 },
    "CR-Q9": { kw: 0.61, current: 3.0, breaker: 1 },
    "CR-Q10": { kw: 2.81, current: 12.4, breaker: 1 },
    "CR-Q11": { kw: 0, current: 0, breaker: 0 },
    "CR-Q12": { kw: 0.41, current: 1.8, breaker: 1 },
    "CR-UPS-1": { kw: 1.74, current: 8.1, breaker: 1, loadPct: 62 },
    "CR-UPS-2": { kw: 1.3, current: 5.9, breaker: 1, loadPct: 48 },
    "CR-BATT-1": { kw: 0.18, current: 0.5, breaker: 1, batteryV: 384.2 },
    "CR-BATT-2": { kw: 0.08, current: 0.2, breaker: 1, batteryV: 386.1 },
    "CR-HVAC-1": { kw: 2.81, current: 12.4, breaker: 1 },
    "CR-HVAC-2": { kw: 0, current: 0, breaker: 0 },
    "CR-LIGHT-AUX": { kw: 0.41, current: 1.8, breaker: 1 },
  };
  return profiles[code] ?? null;
}

function ensureHvacState(assetId) {
  let s = hvacState.get(assetId);
  if (!s) {
    s = {
      supplyC: 16 + Math.random() * 2.5,
      returnC: 22 + Math.random() * 3,
      fanRpm: 520 + Math.random() * 280,
      fanPct: 52 + Math.random() * 28,
      chwSup: 6.5 + Math.random() * 1.2,
      chwRet: 11.5 + Math.random() * 2,
      flow: 2.2 + Math.random() * 1.8,
      coolingKw: 38 + Math.random() * 35,
      compressorOk: 1,
    };
    hvacState.set(assetId, s);
  }
  return s;
}

function ensureItState(assetId, code) {
  let s = itState.get(assetId);
  if (!s) {
    const isVideoWall = code.includes("VW");
    const isWarnPdu = code === "CR-VW-RACK-PDU-B";
    s = {
      rackKw: isVideoWall ? 1.42 : 2.81,
      rackTempC: isVideoWall ? 25.8 : 24.5,
      utilPct: isWarnPdu ? 88 : isVideoWall ? 72 : 64,
      outletsUsed: isVideoWall ? 11 : 18,
      pduAStatus: 1,
      pduBStatus: isWarnPdu ? 0.5 : 1,
    };
    itState.set(assetId, s);
  }
  return s;
}

function envProfile(code) {
  const profiles = {
    "CR-ENV-OP-CONSOLE": { tempC: 23.2, humidityPct: 45 },
    "CR-ENV-VIDEOWALL": { tempC: 23.5, humidityPct: 46 },
    "CR-ENV-RACK-A": { tempC: 24.8, humidityPct: 44 },
    "CR-ENV-RACK-B": { tempC: 25.2, humidityPct: 43 },
    "CR-ENV-BATTERY-ROOM": { tempC: 26.4, humidityPct: 50 },
    "CR-ENV-UPS-ROOM": { tempC: 27.1, humidityPct: 48 },
  };
  return profiles[code] ?? { tempC: 24, humidityPct: 45 };
}

function ensureEnvironmentState(assetId, code) {
  let s = environmentState.get(assetId);
  if (!s) {
    const profile = envProfile(code);
    s = {
      tempC: profile.tempC,
      humidityPct: profile.humidityPct,
      leakState: 0,
      smokeState: 0,
    };
    environmentState.set(assetId, s);
  }
  return s;
}

function stepEnvironment(assetId, code) {
  const s = ensureEnvironmentState(assetId, code);
  const t = new Date();
  if (code.startsWith("CR-LEAK")) {
    s.leakState = Math.random() < 0.0005 ? 1 : s.leakState === 1 && Math.random() < 0.08 ? 0 : s.leakState;
    return [{ assetId, pointKey: "leak_state", value: s.leakState, unit: null, time: t }];
  }
  if (code.startsWith("CR-SMOKE")) {
    s.smokeState = Math.random() < 0.0004 ? 1 : s.smokeState === 1 && Math.random() < 0.1 ? 0 : s.smokeState;
    return [{ assetId, pointKey: "smoke_state", value: s.smokeState, unit: null, time: t }];
  }
  s.tempC = rndWalk(s.tempC, 0.08, 18, 31);
  s.humidityPct = rndWalk(s.humidityPct, 0.4, 30, 70);
  return [
    { assetId, pointKey: "temperature_c", value: s.tempC, unit: "°C", time: t },
    { assetId, pointKey: "humidity_pct", value: s.humidityPct, unit: "%", time: t },
  ];
}

function stepElectrical(assetId, code = "") {
  const s = ensureElecState(assetId);
  const profile = crProfile(code);
  s.v = rndWalk(profile ? 230 : s.v, 0.4, 220, 240);
  s.i = profile
    ? rndWalk(profile.current, 0.3, Math.max(0, profile.current - 1.5), profile.current + 1.5)
    : rndWalk(s.i, 3, 40, 520);
  s.pf = rndWalk(s.pf, 0.01, 0.82, 0.99);
  s.kw = profile ? rndWalk(profile.kw, 0.05, Math.max(0, profile.kw - 0.3), profile.kw + 0.3) : (s.v * s.i * s.pf) / 1000;
  const kva = (s.v * s.i) / 1000;
  const kvar = Math.sqrt(Math.max(0, kva * kva - s.kw * s.kw));
  const breaker = profile ? profile.breaker : Math.random() > 0.002 ? 1 : 0;
  const t = new Date();
  const points = [
    { assetId, pointKey: "voltage_l1_v", value: s.v, unit: "V", time: t },
    { assetId, pointKey: "current_a", value: s.i, unit: "A", time: t },
    { assetId, pointKey: "kw", value: s.kw, unit: "kW", time: t },
    { assetId, pointKey: "kvar", value: kvar, unit: "kVAR", time: t },
    { assetId, pointKey: "pf", value: s.pf, unit: null, time: t },
    { assetId, pointKey: "breaker_main", value: breaker, unit: null, time: t },
  ];
  if (code.startsWith("CR-")) {
    points.push(
      { assetId, pointKey: "frequency_hz", value: rndWalk(50.02, 0.02, 49.8, 50.2), unit: "Hz", time: t },
      { assetId, pointKey: "kwh_today", value: Math.max(0, s.kw * 14.2), unit: "kWh", time: t },
    );
    if (code.startsWith("CR-UPS") || code.startsWith("CR-BATT")) {
      const loadPct = profile?.loadPct ?? Math.min(100, Math.max(0, (s.kw / 2.8) * 100));
      const batteryV = profile?.batteryV ?? (code.endsWith("2") ? 386.1 : 384.2);
      points.push(
        { assetId, pointKey: "load_pct", value: rndWalk(loadPct, 1.2, 0, 100), unit: "%", time: t },
        { assetId, pointKey: "output_voltage_v", value: rndWalk(230, 0.4, 225, 235), unit: "V", time: t },
        { assetId, pointKey: "output_freq_hz", value: rndWalk(50, 0.01, 49.8, 50.2), unit: "Hz", time: t },
        { assetId, pointKey: "battery_v", value: rndWalk(batteryV, 0.3, 360, 392), unit: "V", time: t },
        { assetId, pointKey: "battery_temp_c", value: rndWalk(code.endsWith("2") ? 25.8 : 26.4, 0.08, 20, 32), unit: "°C", time: t },
        { assetId, pointKey: "backup_min", value: rndWalk(code.endsWith("2") ? 54 : 42, 0.4, 5, 80), unit: "min", time: t },
        { assetId, pointKey: "health_pct", value: rndWalk(code.endsWith("2") ? 94 : 96, 0.2, 70, 100), unit: "%", time: t },
      );
    }
  }
  return points;
}

function stepIt(assetId, code) {
  const s = ensureItState(assetId, code);
  s.rackKw = rndWalk(s.rackKw, 0.04, 0.2, code.includes("NET") ? 3.1 : 2.2);
  s.rackTempC = rndWalk(s.rackTempC, 0.08, 20, 32);
  s.utilPct = rndWalk(s.utilPct, 0.8, 20, 96);
  const t = new Date();
  return [
    { assetId, pointKey: "rack_kw", value: s.rackKw, unit: "kW", time: t },
    { assetId, pointKey: "rack_temp_c", value: s.rackTempC, unit: "°C", time: t },
    { assetId, pointKey: "pdu_a_status", value: s.pduAStatus, unit: null, time: t },
    { assetId, pointKey: "pdu_b_status", value: s.pduBStatus, unit: null, time: t },
    { assetId, pointKey: "pdu_util_pct", value: s.utilPct, unit: "%", time: t },
    { assetId, pointKey: "outlets_used", value: s.outletsUsed, unit: null, time: t },
  ];
}

/**
 * @param {{ time: string, assetId: string, pointKey: string, value: number, unit: string | null }[]} readings
 * @returns {typeof readings[]}
 */
function chunkReadingsForNotify(readings) {
  const chunks = [];
  let cur = [];
  for (const r of readings) {
    const trial = cur.length === 0 ? [r] : [...cur, r];
    const json = JSON.stringify({ readings: trial });
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > MAX_NOTIFY_UTF8_BYTES && cur.length > 0) {
      chunks.push(cur);
      cur = [r];
    } else if (bytes > MAX_NOTIFY_UTF8_BYTES) {
      chunks.push([r]);
      cur = [];
    } else {
      cur = trial;
    }
  }
  if (cur.length > 0) {
    chunks.push(cur);
  }
  return chunks;
}

function stepHvac(assetId) {
  const s = ensureHvacState(assetId);
  s.supplyC = rndWalk(s.supplyC, 0.08, 12, 22);
  s.returnC = rndWalk(s.returnC, 0.1, 18, 30);
  s.fanRpm = rndWalk(s.fanRpm, 12, 180, 1100);
  s.fanPct = Math.min(100, Math.max(15, (s.fanRpm / 1100) * 100 + (Math.random() - 0.5) * 4));
  s.chwSup = rndWalk(s.chwSup, 0.05, 5, 10);
  s.chwRet = rndWalk(s.chwRet, 0.06, 9, 16);
  s.flow = rndWalk(s.flow, 0.04, 1.2, 5.5);
  s.coolingKw = rndWalk(s.coolingKw, 1.5, 20, 95);
  if (Math.random() < 0.0008) {
    s.compressorOk = 0;
  } else if (s.compressorOk === 0 && Math.random() < 0.02) {
    s.compressorOk = 1;
  }
  const t = new Date();
  return [
    { assetId, pointKey: "supply_air_temp_c", value: s.supplyC, unit: "°C", time: t },
    { assetId, pointKey: "return_air_temp_c", value: s.returnC, unit: "°C", time: t },
    { assetId, pointKey: "fan_rpm", value: s.fanRpm, unit: "rpm", time: t },
    { assetId, pointKey: "fan_speed_pct", value: s.fanPct, unit: "%", time: t },
    { assetId, pointKey: "chw_flow_lps", value: s.flow, unit: "L/s", time: t },
    { assetId, pointKey: "chw_supply_temp_c", value: s.chwSup, unit: "°C", time: t },
    { assetId, pointKey: "chw_return_temp_c", value: s.chwRet, unit: "°C", time: t },
    { assetId, pointKey: "compressor_ok", value: s.compressorOk, unit: null, time: t },
    { assetId, pointKey: "cooling_kw", value: s.coolingKw, unit: "kW", time: t },
  ];
}

async function loadAssets() {
  const res =
    assetLimit === null
      ? await pool.query(`select id, code, domain from bms.assets order by code asc`)
      : await pool.query(
          `select id, code, domain from bms.assets order by code asc limit $1`,
          [assetLimit],
        );
  return res.rows;
}

async function tick(rows) {
  const endTimer = tickDuration.startTimer();
  const client = await pool.connect();
  try {
    const outRows = [];
    const readings = [];
    for (const row of rows) {
      const batch =
        row.domain === "it"
          ? stepIt(row.id, row.code)
          : row.domain === "hvac"
            ? stepHvac(row.id)
            : row.domain === "environment"
              ? stepEnvironment(row.id, row.code)
              : stepElectrical(row.id, row.code);
      for (const r of batch) {
        outRows.push([r.time, r.assetId, r.pointKey, r.value, r.unit]);
        readings.push({
          time: r.time.toISOString(),
          assetId: r.assetId,
          pointKey: r.pointKey,
          value: r.value,
          unit: r.unit,
        });
      }
    }

    const values = outRows
      .map(
        (_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`,
      )
      .join(", ");
    const flat = outRows.flat();
    await client.query(
      `insert into telemetry.point_values ("time", asset_id, point_key, value, unit) values ${values}`,
      flat,
    );
    pointsWritten.inc(outRows.length);

    for (const part of chunkReadingsForNotify(readings)) {
      await client.query("select pg_notify($1, $2)", [
        NOTIFY_CHANNEL,
        JSON.stringify({ readings: part }),
      ]);
      notifyChunks.inc();
    }
    ticksTotal.inc();
  } finally {
    endTimer();
    client.release();
  }
}

function startMetricsServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404).end("not found");
      return;
    }
    res.setHeader("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });
  server.listen(metricsPort, "0.0.0.0", () => {
    process.stdout.write(`[sim] metrics listening on :${metricsPort}/metrics\n`);
  });
}

async function main() {
  startMetricsServer();
  const assetRows = await loadAssets();
  if (assetRows.length === 0) {
    throw new Error("No assets in bms.assets — run pnpm db:seed");
  }
  const hvacN = assetRows.filter((r) => r.domain === "hvac").length;
  const itN = assetRows.filter((r) => r.domain === "it").length;
  const elecN = assetRows.length - hvacN - itN;
  process.stdout.write(
    `[sim] ${assetRows.length} assets (${elecN} electrical, ${hvacN} hvac, ${itN} it) @ ${rateHz} Hz\n` +
      `  electrical: ${ELECTRICAL_POINT_KEYS.join(", ")}\n` +
      `  control-room electrical: ${CONTROL_ROOM_ELECTRICAL_POINT_KEYS.join(", ")}\n` +
      `  control-room ups: ${CONTROL_ROOM_UPS_POINT_KEYS.join(", ")}\n` +
      `  control-room it: ${CONTROL_ROOM_IT_POINT_KEYS.join(", ")}\n` +
      `  control-room environment: ${CONTROL_ROOM_ENVIRONMENT_POINT_KEYS.join(", ")}\n` +
      `  hvac: ${HVAC_POINT_KEYS.join(", ")}\n`,
  );

  const loop = async () => {
    try {
      await tick(assetRows);
    } catch (err) {
      console.error("[sim] tick failed", err);
    }
  };

  await loop();
  setInterval(loop, intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
