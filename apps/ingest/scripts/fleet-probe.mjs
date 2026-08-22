/**
 * F1.7 read-only fleet probe.
 *
 * Subscribes to every PHE RTU topic in `packages/db/src/phe-catalog.json` and
 * records which ones publish. Writes nothing: no database, no MQTT publish.
 *
 * AGENTS.md §9.6 — reading VALUES never leave this process. Only topic,
 * dev_id, key NAMES and counts are printed.
 *
 *   node apps/ingest/scripts/fleet-probe.mjs [seconds]
 *
 * It lives beside the host rather than at the repo root because `mqtt` is
 * `apps/ingest`'s dependency and the broker is `apps/ingest`'s concern. The
 * result of the runs behind `F1.7` is in `docs/f1.7-fleet-probe.md`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import mqtt from "mqtt";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

/**
 * The listen window, validated rather than coerced.
 *
 * `Number("10m")` is `NaN`, Node clamps a `NaN` timer to 1 ms, and the report
 * would print a full all-silent table before the client had even connected —
 * a typo rendered as "the whole fleet is dead". This script is the evidence
 * base for `docs/f1.7-fleet-probe.md`, so a non-measurement must never be
 * mistakable for a measurement. Capped so a stray argument cannot hold an
 * authenticated session open against the client's broker indefinitely.
 */
const MAX_WINDOW_SECONDS = 3600;
const rawWindow = process.argv[2] ?? "120";
if (!/^\d+$/.test(rawWindow) || Number(rawWindow) < 1 || Number(rawWindow) > MAX_WINDOW_SECONDS) {
  console.error(`window must be a whole number of seconds, 1..${MAX_WINDOW_SECONDS}; got "${rawWindow}"`);
  process.exit(1);
}
const WINDOW_SECONDS = Number(rawWindow);

/**
 * Minimal `.env` reader — avoids a second dependency for three keys.
 *
 * Optional: `.env` is gitignored and a git worktree does not carry one, so an
 * absent file falls through to the ambient environment rather than failing.
 */
function readEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    // A quoted value keeps everything inside matching quotes; an unquoted one
    // ends at a ` #` comment. Taking the rest of the line unconditionally folds
    // `MQTT_PASSWORD=s3cret # pilot` into the secret, and the resulting auth
    // failure names no cause.
    const quoted = /^(["'])(.*)\1$/.exec(value);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, "").trim();
    out[m[1]] = value;
  }
  return out;
}

const env = { ...readEnvFile(resolve(REPO, ".env")), ...process.env };

const host = env.MQTT_HOST ?? "phe.thinkiot.co.in";
const port = Number(env.MQTT_PORT ?? "8883");
const username = env.MQTT_USERNAME;
const password = env.MQTT_PASSWORD;

if (!username || !password) {
  console.error("MQTT_USERNAME / MQTT_PASSWORD are not set — export them or add a repo-root .env");
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(resolve(REPO, "packages/db/src/phe-catalog.json"), "utf8"));

/** topic -> {rtuCode, name, pilot} */
const fleet = new Map();
for (const row of catalog.rows) {
  if (!fleet.has(row.MqttTopic)) {
    fleet.set(row.MqttTopic, {
      rtuCode: row.RTUCode,
      name: row.RTUDisplayName,
      pilot: row.EdgeRTUId === catalog.pilotEdgeRtuId,
    });
  }
}

/** topic -> {messages, firstAt, lastAt, devIds:Set, keys:Set, absentKeys:Set, envelopeExtras:Set} */
const seen = new Map();
for (const topic of fleet.keys()) {
  seen.set(topic, {
    messages: 0,
    firstAt: null,
    lastAt: null,
    devIds: new Set(),
    keys: new Set(),
    absentKeys: new Set(),
    topLevel: new Set(),
    malformed: 0,
  });
}

/**
 * True when a published key carries no reading.
 *
 * These are the three cases `samplesFromPayload` skips, so a key counted here
 * is a key that reaches the adapter and produces nothing. **Whether a value is
 * absent is not the value** — this returns a verdict, never the reading, and
 * §9.6 holds.
 *
 * The first three probe runs counted key *names* per topic and never asked
 * this, which is why both Salkumarhat stations read as publishing normally
 * while sixteen of their twenty-one mapped points had no row: the RTU publishes
 * its Modbus register keys empty when the meter behind it does not answer.
 */
function isAbsentReading(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value));
}

const ENVELOPE = new Set(["dev_id", "ts", "values"]);

/**
 * Every wire-supplied string is scrubbed before it reaches the terminal.
 *
 * `dev_id` and the key names come from broker payloads, and this output is
 * transcribed into `docs/f1.7-fleet-probe.md` as evidence. A device publishing
 * ANSI escapes or a carriage return could otherwise overwrite or forge lines
 * of that evidence. Length-capped for the same reason — one device must not be
 * able to bury the other eleven.
 */
function safe(text, max = 40) {
  const cleaned = String(text).replace(/[^\x20-\x7E]/g, "?");
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/** True once the broker has actually accepted the connection. */
let connected = false;

// The username is a credential (§9.6) and never reaches the output — the
// broker address is what identifies the run.
console.log(`connecting to mqtts://${host}:${port}`);
console.log(`listening for ${WINDOW_SECONDS}s across ${fleet.size} topics\n`);

const client = mqtt.connect(`mqtts://${host}:${port}`, {
  username,
  password,
  rejectUnauthorized: env.MQTT_TLS_REJECT_UNAUTHORIZED !== "false",
  reconnectPeriod: 0,
});

client.on("connect", () => {
  connected = true;
  console.log("connected; subscribing\n");
  for (const topic of fleet.keys()) {
    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) console.error(`  SUBSCRIBE FAILED ${safe(topic, 60)}: ${err.message}`);
    });
  }
});

client.on("error", (err) => {
  console.error(`connection error: ${err.message}`);
  process.exitCode = 1;
  clearTimeout(deadline);
  client.end(true);
  // Deliberately no report: a run that never connected has measured nothing,
  // and printing the all-silent table here is how "we could not reach the
  // broker" becomes "the fleet is dead" in someone's notes.
});

client.on("message", (topic, payload) => {
  const rec = seen.get(topic);
  if (!rec) return;
  rec.messages += 1;
  rec.lastAt = new Date();
  if (rec.firstAt === null) rec.firstAt = rec.lastAt;
  try {
    const body = JSON.parse(payload.toString("utf8"));
    if (typeof body.dev_id === "string") rec.devIds.add(body.dev_id);
    for (const k of Object.keys(body)) {
      if (!ENVELOPE.has(k)) rec.topLevel.add(k);
    }
    const values = body.values;
    if (values !== null && typeof values === "object") {
      for (const [k, v] of Object.entries(values)) {
        rec.keys.add(k);
        if (isAbsentReading(v)) rec.absentKeys.add(k);
      }
    }
  } catch {
    rec.malformed += 1;
  }
});

const deadline = setTimeout(() => {
  client.end(true);
  report();
}, WINDOW_SECONDS * 1000);

function report() {
  // A hung connect raises neither `connect` nor `error` with reconnect off, so
  // the window simply elapses. Without this the table prints identically to a
  // real run and exits 0 — a firewalled host indistinguishable from a dead
  // fleet, in the document this output becomes.
  if (!connected) {
    console.error(
      `\nNO MEASUREMENT: never connected to ${host}:${port} within ${WINDOW_SECONDS}s.`,
    );
    process.exitCode = 1;
    return;
  }

  const publishing = [];
  const silent = [];
  for (const [topic, meta] of fleet) {
    const rec = seen.get(topic);
    (rec.messages > 0 ? publishing : silent).push({ topic, meta, rec });
  }

  console.log(`\n===== PUBLISHING: ${publishing.length} / ${fleet.size} =====`);
  for (const { meta, rec } of publishing) {
    const mismatch = rec.devIds.size > 0 && !rec.devIds.has(meta.rtuCode);
    console.log(
      [
        meta.pilot ? "PILOT " : "      ",
        meta.rtuCode,
        meta.name.padEnd(22),
        `msgs=${String(rec.messages).padStart(4)}`,
        `dev_id=${safe([...rec.devIds].join(",")) || "-"}${mismatch ? "  <-- MISMATCH vs rtu_code" : ""}`,
        `values_keys=${rec.keys.size}`,
        `absent=${rec.absentKeys.size}`,
        rec.topLevel.size ? `top_level=${safe([...rec.topLevel].join(","), 80)}` : "",
        rec.malformed ? `malformed=${rec.malformed}` : "",
      ].join(" "),
    );
    // Named, not just counted: which keys are dark is what tells a failed field
    // device from a wrong mapping, and that is the whole point of measuring it.
    if (rec.absentKeys.size > 0) {
      console.log(`         absent: ${[...rec.absentKeys].sort().map((k) => safe(k, 24)).join(" ")}`);
    }
  }

  console.log(`\n===== SILENT: ${silent.length} / ${fleet.size} =====`);
  for (const { meta } of silent) {
    console.log(`      ${meta.rtuCode} ${meta.name}`);
  }

  const allKeys = new Set();
  for (const { rec } of publishing) for (const k of rec.keys) allKeys.add(k);
  console.log(`\ndistinct values keys across fleet: ${allKeys.size}`);
  console.log([...allKeys].sort().map((k) => safe(k, 24)).join(" "));
}
