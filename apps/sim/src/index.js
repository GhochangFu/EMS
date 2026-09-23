/**
 * Telemetry simulator — writes electrical points for `electrical` assets,
 * HVAC/environment/IT points for their domains, and (E4.3 U12) water flow
 * points for the demo water plant's five `water` assets, into
 * `telemetry.point_values`, then `pg_notify('bms_telemetry', …)` for the API
 * WebSocket fan-out.
 *
 * **`SIM_ASSET_COUNT` and the demo water plant.** The default of `64` selects
 * the first 64 assets by code (`loadAssets`, ordered `order by code asc`), and
 * `WTR-*` sorts after every ESKOM code the seed ships today, so a local run
 * with the default never reaches the water assets. `docker-compose.yml` sets
 * `SIM_ASSET_COUNT=all`, and a local run that wants the water plant's flows
 * must do the same: `SIM_ASSET_COUNT=all pnpm --filter sim start`.
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
const siteNames = String(process.env.SIM_SITE_NAMES ?? "")
  .split(",")
  .map((site) => site.trim())
  .filter(Boolean);
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

/** @type {Map<string, Map<string, number>>} one flow-key → value map per water asset. */
const waterState = new Map();

/**
 * The banner's list of every flow key the demo water plant emits, across all
 * five classes — a plain duplicate of `stepWater`'s own `WATER_FLOWS` table
 * (kept inside the function so `tests/e4.3-demo-water-plant.test.ts` can read
 * it back from `stepWater`'s body text alone). Twelve distinct keys: the STP
 * and the ETP both carry `influent_flow_klh` (E4.3 plan, PR 3 U12).
 */
const WATER_POINT_KEYS = [
  "raw_water_flow_klh",
  "treated_water_flow_klh",
  "feed_flow_klh",
  "permeate_flow_klh",
  "reject_flow_klh",
  "makeup_flow_klh",
  "blowdown_flow_klh",
  "circ_flow_klh",
  "influent_flow_klh",
  "effluent_flow_klh",
  "ras_flow_klh",
  "discharge_flow_klh",
];

/** Warned-once set, so an unrecognized water code logs one line, not one per tick. */
const warnedUnknownWaterCodes = new Set();

function rndWalk(prev, delta, min, max) {
  const x = prev + (Math.random() * 2 - 1) * delta;
  return Math.min(max, Math.max(min, x));
}

function ensureElecState(assetId) {
  let s = elecState.get(assetId);
  if (!s) {
    s = {
      v: 228 + Math.random() * 8,
      i: 200 + Math.random() * 60,
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
    const isWesternCape = code.startsWith("CR-");
    const isWarnPdu = code === "CR-VW-RACK-PDU-B";
    s = {
      rackKw: isVideoWall ? 3.2 : isWesternCape ? 6.2 : 77,
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

/** `assetId → Map<flowKey, value>`, one map per demo water plant asset. */
function ensureWaterState(assetId, code) {
  let s = waterState.get(assetId);
  if (!s) {
    s = new Map();
    waterState.set(assetId, s);
  }
  return s;
}

/**
 * The code infix names the class (`WTR-<CLASS>-01`, `eskom-assets-seed.ts`
 * via `water-plant-demo-seed.ts`). `null` for a water asset with none of the
 * five known infixes — `stepWater` skips it and warns once, rather than
 * emitting an arbitrary class's flows (fail closed, never fail silent-wrong).
 */
function waterClassOf(code) {
  if (code.includes("-WTP-")) return "WTP";
  if (code.includes("-RO-")) return "RO";
  if (code.includes("-CT-")) return "CT";
  if (code.includes("-STP-")) return "STP";
  if (code.includes("-ETP-")) return "ETP";
  return null;
}

/**
 * `E4.3` PR 3 U12 — the demo water plant's five stages. Bases are `KL/hr`,
 * chosen so the site's daily balance reads intake ≈ 1200 KL (WTP raw × 24),
 * reuse ≈ 264 (STP effluent × 24), discharge ≈ 168 (ETP discharge × 24),
 * consumed ≈ 1032, matching the plan's worked figures. `reject_flow_klh`
 * (RO), `circ_flow_klh` (CT) and `ras_flow_klh` (STP) are realistic third
 * flows no balance formula reads — `water-plant-demo-seed.ts`'s
 * `measuredFlowKeys` for those three classes correctly omits them (E4.3 U11);
 * `tests/e4.3-demo-water-plant.test.ts` holds this table's per-class key set
 * equal to `measuredFlowKeys` plus exactly those three named extras, so a
 * class emitting another class's keys — or dropping one of its own — reddens.
 *
 * The table is declared inside this function, not at module scope, so
 * `tests/e4.3-demo-water-plant.test.ts`'s `simBodyOf("stepWater")` (a text
 * read of this function's body only) can see the key names; `WATER_POINT_KEYS`
 * above is the same list, kept separately for the startup banner.
 */
function stepWater(assetId, code) {
  const WATER_FLOWS = {
    WTP: { raw_water_flow_klh: 50, treated_water_flow_klh: 46 },
    RO: { feed_flow_klh: 20, permeate_flow_klh: 15, reject_flow_klh: 5 },
    CT: { makeup_flow_klh: 6, blowdown_flow_klh: 1.5, circ_flow_klh: 300 },
    STP: { influent_flow_klh: 12, effluent_flow_klh: 11, ras_flow_klh: 4 },
    ETP: { influent_flow_klh: 8, discharge_flow_klh: 7 },
  };
  const klass = waterClassOf(code);
  if (!klass) {
    if (!warnedUnknownWaterCodes.has(code)) {
      warnedUnknownWaterCodes.add(code);
      console.warn(
        `[sim] water asset ${code} matches none of -WTP-/-RO-/-CT-/-STP-/-ETP- — emitting no flows`,
      );
    }
    return [];
  }
  const bases = WATER_FLOWS[klass];
  const s = ensureWaterState(assetId, code);
  const t = new Date();
  const points = [];
  for (const key of Object.keys(bases)) {
    const base = bases[key];
    const prev = s.has(key) ? s.get(key) : base;
    const value = rndWalk(prev, Math.max(base * 0.1, 0.01), 0, base * 1.5);
    s.set(key, value);
    points.push({ assetId, pointKey: key, value, unit: "KL/hr", time: t });
  }
  return points;
}

function stepElectrical(assetId, code = "") {
  const s = ensureElecState(assetId);
  const profile = crProfile(code);
  s.v = rndWalk(profile ? 230 : s.v, 0.4, 220, 240);
  s.i = profile
    ? rndWalk(profile.current, 0.3, Math.max(0, profile.current - 1.5), profile.current + 1.5)
    : rndWalk(s.i, 3, 200, 260);
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
  const isVideoWall = code.includes("VW");
  const isWesternCape = code.startsWith("CR-");
  s.rackKw = isVideoWall
    ? rndWalk(s.rackKw, 0.03, 2.5, 4)
    : isWesternCape
      ? rndWalk(s.rackKw, 0.05, 5, 7.5)
      : rndWalk(s.rackKw, 0.3, 70, 85);
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

/**
 * `F4.73` — the asset read runs inside a tenant context, once per organization.
 *
 * **Why this is no longer one query.** `bms.assets` has carried a
 * `tenant_isolation` policy since migration `0047`, and `DATABASE_URL` names
 * `bms_owner`, which `0041` binds with `FORCE ROW LEVEL SECURITY`. A `SELECT`
 * with no tenant context therefore matches **zero rows** — not an error, an
 * empty result — and this process reported that as
 * `No assets in bms.assets — run pnpm db:seed`, naming the one remedy that
 * cannot help. Measured 2026-08-31: `count(*)` on `bms.assets` is `0` as
 * `bms_owner` with no context and `148` as the superuser.
 *
 * **The mechanism is ADR 0043 decision 10's, unchanged.**
 * `select set_config('app.current_organization', $1, true)` inside a
 * transaction. `is_local = true`, so the setting dies at `COMMIT` and cannot
 * leak into the next caller on a pooled connection — and it must be inside a
 * transaction for that to be true, which is why `begin` comes first rather than
 * for tidiness. The organization id is a bind parameter and never a
 * concatenated `SET LOCAL`, for the same reason `withTenant` uses one.
 *
 * **Only the read needs it.** The tick writes `telemetry.point_values`, and ADR
 * 0043 decision 9 makes `telemetry.*` a stated permanent exception with no
 * policy, so `tick()` opens no transaction for a context it does not need.
 * `bms.organizations` carries no policy either — it *is* the tenant table — so
 * the organization list is read without one.
 *
 * **The cap is applied across organizations, never per organization.**
 * `SIM_ASSET_COUNT` means "the first N assets by code"; a `limit` inside the
 * per-organization query would silently mean N *per tenant*, and would grow the
 * simulator's load every time a tenant is added.
 */
async function loadAssets() {
  const organizations = await pool.query(`select id from bms.organizations order by code asc`);
  const organizationIds = organizations.rows.map((row) => row.id);
  if (organizationIds.length === 0) {
    throw new Error("No organizations in bms.organizations — run pnpm db:seed");
  }

  const rows = [];
  for (const organizationId of organizationIds) {
    rows.push(...(await loadAssetsForOrganization(organizationId)));
  }
  // Sorted here rather than per query: the passes are each ordered, and
  // concatenating ordered lists does not give an ordered list.
  rows.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return assetLimit === null ? rows : rows.slice(0, assetLimit);
}

/** One organization's simulated assets, read inside that organization's context. */
async function loadAssetsForOrganization(organizationId) {
  const filters = [
    `coalesce(meta->>'telemetryEnabled', 'true') <> 'false'`,
    `coalesce(meta->>'telemetrySource', 'sim') <> 'mqtt'`,
  ];
  const params = [];
  if (siteNames.length > 0) {
    params.push(siteNames);
    filters.push(`site_name = any($${params.length}::text[])`);
  }
  const where = `where ${filters.join(" and ")}`;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('app.current_organization', $1, true)`, [organizationId]);
    const res = await client.query(
      `select id, code, domain, site_name from bms.assets ${where} order by code asc`,
      params,
    );
    await client.query("commit");
    return res.rows;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
              : row.domain === "water"
                ? stepWater(row.id, row.code)
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

    if (outRows.length > 0) {
      // `stepWater` can return zero points for an unrecognized water code
      // (fail-closed, warned once) — nothing else here ever does, but the
      // guard is unconditional so the INSERT is never built with an empty
      // `values (...)` list.
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
    }

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
    // `F4.73`: every read above runs inside a tenant context, so an empty result
    // now means the data is empty or the filter excluded it — never a policy
    // refusal, which is what this message used to hide.
    throw new Error(
      "No assets visible in bms.assets — run pnpm db:seed" +
        (siteNames.length > 0 ? `, or check SIM_SITE_NAMES (${siteNames.join(", ")})` : ""),
    );
  }
  const hvacN = assetRows.filter((r) => r.domain === "hvac").length;
  const itN = assetRows.filter((r) => r.domain === "it").length;
  const waterN = assetRows.filter((r) => r.domain === "water").length;
  const elecN = assetRows.length - hvacN - itN - waterN;
  process.stdout.write(
    `[sim] ${assetRows.length} assets (${elecN} electrical, ${hvacN} hvac, ${itN} it, ${waterN} water) @ ${rateHz} Hz\n` +
      (siteNames.length > 0 ? `  sites: ${siteNames.join(", ")}\n` : "") +
      `  electrical: ${ELECTRICAL_POINT_KEYS.join(", ")}\n` +
      `  control-room electrical: ${CONTROL_ROOM_ELECTRICAL_POINT_KEYS.join(", ")}\n` +
      `  control-room ups: ${CONTROL_ROOM_UPS_POINT_KEYS.join(", ")}\n` +
      `  control-room it: ${CONTROL_ROOM_IT_POINT_KEYS.join(", ")}\n` +
      `  control-room environment: ${CONTROL_ROOM_ENVIRONMENT_POINT_KEYS.join(", ")}\n` +
      `  hvac: ${HVAC_POINT_KEYS.join(", ")}\n` +
      `  water: ${WATER_POINT_KEYS.join(", ")}\n`,
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
