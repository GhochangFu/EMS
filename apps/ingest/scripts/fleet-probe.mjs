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
const WINDOW_SECONDS = Number(process.argv[2] ?? "120");

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
    out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
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

/** topic -> {messages, firstAt, lastAt, devIds:Set, keys:Set, envelopeExtras:Set} */
const seen = new Map();
for (const topic of fleet.keys()) {
  seen.set(topic, {
    messages: 0,
    firstAt: null,
    lastAt: null,
    devIds: new Set(),
    keys: new Set(),
    topLevel: new Set(),
    malformed: 0,
  });
}

const ENVELOPE = new Set(["dev_id", "ts", "values"]);

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
  console.log("connected; subscribing\n");
  for (const topic of fleet.keys()) {
    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) console.error(`  SUBSCRIBE FAILED ${topic}: ${err.message}`);
    });
  }
});

client.on("error", (err) => {
  console.error(`connection error: ${err.message}`);
  process.exitCode = 1;
  client.end(true);
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
      for (const k of Object.keys(values)) rec.keys.add(k);
    }
  } catch {
    rec.malformed += 1;
  }
});

setTimeout(() => {
  client.end(true);
  report();
}, WINDOW_SECONDS * 1000);

function report() {
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
        `dev_id=${[...rec.devIds].join(",") || "-"}${mismatch ? "  <-- MISMATCH vs rtu_code" : ""}`,
        `values_keys=${rec.keys.size}`,
        rec.topLevel.size ? `top_level=${[...rec.topLevel].join(",")}` : "",
        rec.malformed ? `malformed=${rec.malformed}` : "",
      ].join(" "),
    );
  }

  console.log(`\n===== SILENT: ${silent.length} / ${fleet.size} =====`);
  for (const { meta } of silent) {
    console.log(`      ${meta.rtuCode} ${meta.name}`);
  }

  const allKeys = new Set();
  for (const { rec } of publishing) for (const k of rec.keys) allKeys.add(k);
  console.log(`\ndistinct values keys across fleet: ${allKeys.size}`);
  console.log([...allKeys].sort().join(" "));
}
