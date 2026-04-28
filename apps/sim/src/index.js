/**
 * Telemetry simulator — writes electrical points for `electrical` assets and
 * HVAC points for `hvac` assets into `telemetry.point_values`, then
 * `pg_notify('bms_telemetry', …)` for the API WebSocket fan-out.
 */
import { config } from "dotenv";
import http from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import pg from "pg";
import promClient from "prom-client";

const require = createRequire(import.meta.url);
const { ELECTRICAL_POINT_KEYS, HVAC_POINT_KEYS } = require("@bms/shared");

const pkgRoot = process.cwd();
config({ path: resolve(pkgRoot, "../../apps/api/.env") });
config({ path: resolve(pkgRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const rateHz = Math.max(0.1, Number(process.env.SIM_RATE_HZ ?? "1"));
const intervalMs = 1000 / rateHz;
const assetLimit = Math.min(64, Math.max(1, Number(process.env.SIM_ASSET_COUNT ?? "32")));
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

function stepElectrical(assetId) {
  const s = ensureElecState(assetId);
  s.v = rndWalk(s.v, 0.4, 220, 240);
  s.i = rndWalk(s.i, 3, 40, 520);
  s.pf = rndWalk(s.pf, 0.01, 0.82, 0.99);
  s.kw = (s.v * s.i * s.pf) / 1000;
  const kva = (s.v * s.i) / 1000;
  const kvar = Math.sqrt(Math.max(0, kva * kva - s.kw * s.kw));
  const breaker = Math.random() > 0.002 ? 1 : 0;
  const t = new Date();
  return [
    { assetId, pointKey: "voltage_l1_v", value: s.v, unit: "V", time: t },
    { assetId, pointKey: "current_a", value: s.i, unit: "A", time: t },
    { assetId, pointKey: "kw", value: s.kw, unit: "kW", time: t },
    { assetId, pointKey: "kvar", value: kvar, unit: "kVAR", time: t },
    { assetId, pointKey: "pf", value: s.pf, unit: null, time: t },
    { assetId, pointKey: "breaker_main", value: breaker, unit: null, time: t },
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
  const res = await pool.query(
    `select id, domain from bms.assets order by code asc limit $1`,
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
        row.domain === "hvac" ? stepHvac(row.id) : stepElectrical(row.id);
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
  const elecN = assetRows.length - hvacN;
  process.stdout.write(
    `[sim] ${assetRows.length} assets (${elecN} electrical, ${hvacN} hvac) @ ${rateHz} Hz\n` +
      `  electrical: ${ELECTRICAL_POINT_KEYS.join(", ")}\n` +
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
