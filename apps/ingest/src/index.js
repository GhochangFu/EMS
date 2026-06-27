/**
 * PHE MQTT ingest — subscribes to ThinkIoT topics and writes telemetry.point_values.
 * Pilot: gateways with ingest_enabled = true (Bhutnirghat I by default).
 */
import { config } from "dotenv";
import http from "node:http";
import { resolve } from "node:path";
import mqtt from "mqtt";
import pg from "pg";

import { resolveMqttConnection } from "./rtu-config.js";

const pkgRoot = process.cwd();
config({ path: resolve(pkgRoot, "../../apps/api/.env") });
config({ path: resolve(pkgRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const mqttHost = process.env.MQTT_HOST ?? "phe.thinkiot.co.in";
const mqttPort = Number(process.env.MQTT_PORT ?? "8883");
const mqttUser = process.env.MQTT_USERNAME;
const mqttPassword = process.env.MQTT_PASSWORD;

const metricsPort = Number(process.env.INGEST_METRICS_PORT ?? "9102");
const NOTIFY_CHANNEL = "bms_telemetry";
const MAX_NOTIFY_UTF8_BYTES = 7000;

const pool = new pg.Pool({ connectionString: databaseUrl });

/** @type {Map<string, { assetId: string, pointKey: string, unit: string | null }[]>} */
const mappingByRtu = new Map();

/** @type {Map<string, string>} */
const topicByRtu = new Map();

function chunkReadings(readings) {
  const chunks = [];
  let cur = [];
  for (const r of readings) {
    const trial = cur.length === 0 ? [r] : [...cur, r];
    const json = JSON.stringify({ readings: trial });
    if (Buffer.byteLength(json, "utf8") > MAX_NOTIFY_UTF8_BYTES && cur.length > 0) {
      chunks.push(cur);
      cur = [r];
    } else if (Buffer.byteLength(json, "utf8") > MAX_NOTIFY_UTF8_BYTES) {
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

/** @type {{ host: string, port: number, username?: string, password?: string } | null} */
let activeMqttConnection = null;

async function loadMapping() {
  const res = await pool.query(`
    SELECT
      r.rtu_code,
      r.mqtt_topic,
      a.id AS asset_id,
      ap.point_key,
      ap.source_data_key,
      ap.unit,
      c.config AS connection_config,
      c.credentials_ciphertext,
      c.credentials_iv
    FROM bms.rtus r
    INNER JOIN bms.assets a ON a.rtu_id = r.id
    INNER JOIN bms.asset_points ap ON ap.asset_id = a.id AND ap.active = true
    LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id
    WHERE r.ingest_enabled = true
      AND r.source_type = 'mqtt'
      AND COALESCE(a.meta->>'telemetrySource', 'mqtt') = 'mqtt'
  `);

  mappingByRtu.clear();
  topicByRtu.clear();
  activeMqttConnection = null;

  for (const row of res.rows) {
    const rtuCode = String(row.rtu_code);
    if (!activeMqttConnection && row.connection_config) {
      activeMqttConnection = resolveMqttConnection({
        config: row.connection_config,
        credentials_ciphertext: row.credentials_ciphertext,
        credentials_iv: row.credentials_iv,
      });
    }
    if (!mappingByRtu.has(rtuCode)) {
      mappingByRtu.set(rtuCode, []);
    }
    mappingByRtu.get(rtuCode)?.push({
      assetId: String(row.asset_id),
      pointKey: String(row.point_key),
      unit: row.unit === null ? null : String(row.unit),
      sourceDataKey: String(row.source_data_key),
    });
    topicByRtu.set(rtuCode, String(row.mqtt_topic));
  }
}

function parsePayload(raw) {
  const body = JSON.parse(raw);
  const devId = String(body.dev_id ?? "");
  const values =
    body.values && typeof body.values === "object" ? body.values : body;
  const tsMs = Number(body.ts ?? Date.now());
  const time = Number.isFinite(tsMs) ? new Date(tsMs) : new Date();
  return { devId, values, time };
}

async function handleMessage(_topic, payload) {
  let parsed;
  try {
    parsed = parsePayload(payload.toString("utf8"));
  } catch {
    return;
  }

  const points = mappingByRtu.get(parsed.devId);
  if (!points || points.length === 0) {
    return;
  }

  const readings = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const point of points) {
      const rawVal = parsed.values[point.sourceDataKey];
      if (rawVal === undefined || rawVal === null || rawVal === "") {
        continue;
      }
      const value = Number(rawVal);
      if (!Number.isFinite(value)) {
        continue;
      }
      const row = {
        time: parsed.time,
        assetId: point.assetId,
        pointKey: point.pointKey,
        value,
        unit: point.unit,
      };
      await client.query(
        `
        INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (time, asset_id, point_key) DO UPDATE SET
          value = EXCLUDED.value,
          unit = EXCLUDED.unit
        `,
        [row.time, row.assetId, row.pointKey, row.value, row.unit],
      );
      readings.push({
        time: row.time.toISOString(),
        assetId: row.assetId,
        pointKey: row.pointKey,
        value: row.value,
        unit: row.unit,
      });
    }
    await client.query("COMMIT");

    for (const chunk of chunkReadings(readings)) {
      await client.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, JSON.stringify({ readings: chunk })]);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  await loadMapping();
  const topics = [...new Set(topicByRtu.values())];
  if (topics.length === 0) {
    throw new Error("No ingest_enabled RTUs found; run db:seed after migration");
  }

  const conn =
    activeMqttConnection ??
    resolveMqttConnection(null);
  if (!conn.username || !conn.password) {
    throw new Error("MQTT credentials required (per-RTU config or MQTT_USERNAME/MQTT_PASSWORD env)");
  }

  const url = `mqtts://${conn.host}:${conn.port}`;
  const client = mqtt.connect(url, {
    username: conn.username,
    password: conn.password,
    reconnectPeriod: Number(process.env.MQTT_RECONNECT_MS ?? "5000"),
    rejectUnauthorized: process.env.MQTT_TLS_REJECT_UNAUTHORIZED !== "false",
  });

  client.on("connect", () => {
    for (const topic of topics) {
      client.subscribe(topic, { qos: 0 });
    }
  });

  client.on("message", (topic, payload) => {
    handleMessage(topic, payload).catch(() => {
      /* logged via metrics in future sprint */
    });
  });

  http
    .createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`ingest ok topics=${topics.length} rtus=${mappingByRtu.size}\n`);
    })
    .listen(metricsPort);

  setInterval(() => {
    loadMapping().catch(() => {});
  }, Number(process.env.INGEST_RELOAD_MS ?? "60000"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
