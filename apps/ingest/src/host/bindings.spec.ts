import { z } from "zod";

import type { IngestProtocol } from "@bms/shared/ingest";

import type { IngestAdapterFactory } from "../adapter/types.js";
import { mqttAdapterFactory, type MqttDevice } from "../adapters/mqtt.js";
import {
  BINDING_QUERY,
  planEndpoints,
  type BindingRow,
  type PlanOptions,
} from "./bindings.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A poll-mode stand-in for the F1.2 fan-out, so non-MQTT paths are exercised now. */
const modbusFactory: IngestAdapterFactory<
  { host: string; port: number; framing: "tcp" | "rtu-over-tcp" },
  { unitId: number }
> = {
  protocol: "modbus_tcp",
  mode: "poll",
  configSchema: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    // An **enum**, deliberately. Zod's `invalid_type` message names the expected
    // and received *types* ("Expected number, received string") and never the
    // value, so a value-echo assertion built on it cannot fail. `invalid_enum_value`
    // interpolates the received value verbatim — which is what makes the
    // no-secrets-in-the-skip-report assertion below a real gate.
    framing: z.enum(["tcp", "rtu-over-tcp"]).default("tcp"),
  }),
  deviceSchema: z.object({ unitId: z.number().int() }),
  endpointKey: (config) => `${config.host}:${config.port}`,
  create: () => {
    throw new Error("not constructed in these tests");
  },
};

const ENV_CONNECTION = { host: "phe.thinkiot.co.in", port: 8883 };

function makeOptions(overrides: Partial<PlanOptions> = {}): PlanOptions {
  return {
    lookup: (protocol: IngestProtocol) =>
      protocol === "mqtt"
        ? (mqttAdapterFactory as unknown as IngestAdapterFactory)
        : protocol === "modbus_tcp"
          ? (modbusFactory as unknown as IngestAdapterFactory)
          : undefined,
    decryptCredentials: () => ({ username: "db-user", password: "db-secret" }),
    resolveMqttConnection: () => ({
      ...ENV_CONNECTION,
      username: "env-user",
      password: "env-secret",
    }),
    credentialKeyConfigured: true,
    ...overrides,
  };
}

function row(overrides: Partial<BindingRow> = {}): BindingRow {
  return {
    rtu_id: "rtu-uuid-1",
    rtu_code: "RTU-1",
    source_type: "mqtt",
    mqtt_topic: "Airsprint-1051/Data/RTU-1",
    asset_id: "asset-1",
    telemetry_source: "mqtt",
    point_key: "FLOW_RATE",
    source_data_key: "flow",
    unit: "m³/h",
    config_protocol: null,
    connection_config: null,
    credentials_ciphertext: null,
    credentials_iv: null,
    ...overrides,
  };
}

/** The binding query, protocol resolution and endpoint grouping (ADR 0016 §3, §4). */
export function runBindingsTests(): void {
  // ---- the query binds on the ADR 0018 source axis -------------------------

  {
    const sql = BINDING_QUERY.replace(/\s+/g, " ");
    // ADR 0018 decision 3 moved telemetry provenance to the point so one asset
    // can mix measured, manual and computed points. `index.js` still joins
    // `a.rtu_id = r.id`; regressing to that here would silently re-merge the
    // two axes and pick up manual (`F1.8`) and computed points as if a gateway
    // had sent them.
    assert(sql.includes("ap.rtu_id = r.id"), "the source axis must be asset_points.rtu_id");
    assert(
      !/\ba\.rtu_id\b/.test(sql),
      "assets.rtu_id is the pre-ADR-0018 axis and must not appear in the binding query",
    );
    assert(
      sql.includes("ap.source_kind = 'measured'"),
      "only gateway-measured points may be ingested — manual and computed points are not telemetry",
    );
    assert(sql.includes("ap.active = true"), "inactive points must not be bound");
    assert(sql.includes("r.ingest_enabled = true"), "ingest_enabled remains the on/off switch");
    assert(
      sql.includes("LEFT JOIN bms.rtu_connection_configs"),
      "the config join must stay a LEFT JOIN — the pilot RTU has no config row",
    );
    // The filter is applied per protocol in planEndpoints, not in SQL.
    assert(
      !sql.includes("telemetrySource'") || sql.includes("AS telemetry_source"),
      "telemetrySource must be selected, not filtered, in the multi-protocol query",
    );
  }

  // ---- one broker, many RTUs, one endpoint ---------------------------------

  {
    const { endpoints, skipped } = planEndpoints(
      [
        row(),
        row({ rtu_id: "rtu-uuid-2", rtu_code: "RTU-2", mqtt_topic: "Airsprint-1051/Data/RTU-2", asset_id: "asset-2" }),
      ],
      makeOptions(),
    );
    assert(skipped.length === 0, `nothing should be skipped: ${JSON.stringify(skipped)}`);
    // MQTT returns `${host}:${port}`, so one connection serves every PHE RTU —
    // which is what index.js does with a single mqtt.connect().
    assert(endpoints.length === 1, `one broker means one endpoint, got ${endpoints.length}`);
    assert(
      endpoints[0].endpointKey === "phe.thinkiot.co.in:8883",
      `wrong endpoint key: ${endpoints[0].endpointKey}`,
    );
    assert(endpoints[0].bindings.length === 2, "both RTUs bind to the one endpoint");
    const codes = endpoints[0].bindings.map((b) => b.deviceKey).sort();
    assert(codes.join(",") === "RTU-1,RTU-2", `wrong device keys: ${codes.join(",")}`);
  }

  // ---- different brokers are different endpoints ---------------------------

  {
    let call = 0;
    const { endpoints } = planEndpoints(
      [row(), row({ rtu_id: "rtu-uuid-2", rtu_code: "RTU-2" })],
      makeOptions({
        resolveMqttConnection: () => {
          call += 1;
          return { host: call === 1 ? "broker-a" : "broker-b", port: 8883 };
        },
      }),
    );
    assert(endpoints.length === 2, `two brokers means two endpoints, got ${endpoints.length}`);
  }

  // ---- the mqtt_topic shim -------------------------------------------------

  {
    const { endpoints } = planEndpoints([row()], makeOptions());
    const device = endpoints[0].bindings[0].device as MqttDevice;
    assert(
      device.topic === "Airsprint-1051/Data/RTU-1",
      `the rtus.mqtt_topic column must populate device.topic, got ${device.topic}`,
    );
  }

  {
    // "so a written `device.topic` wins once it exists" (§3) — the shim is a
    // compatibility layer, not a permanent override.
    const { endpoints } = planEndpoints(
      [row({ connection_config: { device: { topic: "written/topic" } } })],
      makeOptions(),
    );
    const device = endpoints[0].bindings[0].device as MqttDevice;
    assert(device.topic === "written/topic", `a written device.topic must win, got ${device.topic}`);
  }

  {
    // An MQTT RTU with neither a column value nor a written topic cannot be
    // subscribed to. It must be skipped with a reason, not crash the host.
    const { endpoints, skipped } = planEndpoints(
      [row({ mqtt_topic: null })],
      makeOptions(),
    );
    assert(endpoints.length === 0, "an RTU with no topic cannot form an endpoint");
    assert(
      skipped.some((s) => s.reason === "invalid-device-config"),
      `a topicless MQTT RTU must be reported: ${JSON.stringify(skipped)}`,
    );
  }

  // ---- telemetrySource is scoped to MQTT ----------------------------------

  {
    // index.js:82 applies this unconditionally. It is the mutual exclusion that
    // stops apps/sim and ingest writing the same asset, and it is right for a
    // single-protocol process.
    const { endpoints, skipped } = planEndpoints(
      [row({ telemetry_source: "simulator" })],
      makeOptions(),
    );
    assert(endpoints.length === 0, "a simulator-owned asset must not be ingested over MQTT");
    assert(
      skipped.some((s) => s.reason === "no-mqtt-owned-points"),
      "the exclusion must be reported, not silent",
    );
  }

  {
    // Absent meta defaults to 'mqtt', matching index.js's COALESCE.
    const { endpoints } = planEndpoints([row({ telemetry_source: null })], makeOptions());
    assert(endpoints.length === 1, "an asset with no telemetrySource meta defaults to mqtt");
  }

  {
    // **The scoping that matters.** Lifting the filter into the multi-protocol
    // query unchanged would drop every point on a Modbus RTU whose assets are
    // marked 'catalog' — silently, because a skipped RTU logs once and looks
    // like ordinary noise.
    const { endpoints, skipped } = planEndpoints(
      [
        row({
          source_type: "modbus_tcp",
          config_protocol: "modbus_tcp",
          telemetry_source: "catalog",
          connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 3 } },
        }),
      ],
      makeOptions(),
    );
    assert(
      endpoints.length === 1,
      `a Modbus asset marked 'catalog' must still bind: ${JSON.stringify(skipped)}`,
    );
    assert(endpoints[0].protocol === "modbus_tcp", "the resolved protocol is modbus_tcp");
    assert(endpoints[0].endpointKey === "10.0.0.5:502", "the Modbus endpoint key is host:port");
  }

  // ---- protocol resolution -------------------------------------------------

  {
    // `protocol := rtu_connection_configs.protocol ?? rtus.source_type` (§3).
    const { endpoints } = planEndpoints(
      [
        row({
          source_type: "mqtt",
          config_protocol: "modbus_tcp",
          connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
        }),
      ],
      makeOptions(),
    );
    assert(
      endpoints[0].protocol === "modbus_tcp",
      "the config row's protocol must win over rtus.source_type",
    );
  }

  {
    // `source_type` defaults to 'catalog' — the ordinary case for the synthetic
    // RTUs ADR 0018 describes. Skipped, never thrown on.
    const { endpoints, skipped } = planEndpoints(
      [row({ source_type: "catalog", config_protocol: null })],
      makeOptions(),
    );
    assert(endpoints.length === 0, "a catalog RTU forms no endpoint");
    assert(
      skipped[0].reason === "unsupported-protocol" && skipped[0].detail === "catalog",
      `wrong skip reason: ${JSON.stringify(skipped[0])}`,
    );
  }

  {
    // In the protocol union but with no adapter yet — every protocol but mqtt
    // until the fan-out lands.
    const { skipped } = planEndpoints(
      [row({ config_protocol: "snmp" })],
      makeOptions(),
    );
    assert(
      skipped[0].reason === "no-adapter" && skipped[0].detail === "snmp",
      `a registered-but-unimplemented protocol must be reported: ${JSON.stringify(skipped[0])}`,
    );
  }

  {
    const { skipped } = planEndpoints([row({ rtu_code: null })], makeOptions());
    assert(
      skipped[0].reason === "missing-rtu-code",
      "deviceKey resolves to rtus.rtu_code; without one the wire identifier is unknown",
    );
  }

  // ---- one bad RTU never takes down the others ----------------------------

  {
    // "A failing adapter's blast radius is exactly one endpoint" (§5). The same
    // has to hold at plan time, or one malformed config row stops the pilot
    // before an adapter is ever constructed.
    const { endpoints, skipped } = planEndpoints(
      [
        row({ rtu_id: "bad", rtu_code: "BAD", config_protocol: "modbus_tcp", connection_config: { host: "" } }),
        row(),
      ],
      makeOptions(),
    );
    assert(endpoints.length === 1, "the healthy MQTT endpoint must survive a broken sibling");
    assert(endpoints[0].bindings[0].deviceKey === "RTU-1", "the surviving endpoint is the good one");
    assert(skipped.length === 1, "the broken RTU is reported exactly once");
  }

  // ---- validation failures name paths, never values ------------------------

  {
    const { skipped } = planEndpoints(
      [
        row({
          rtu_code: "RTU-9",
          config_protocol: "modbus_tcp",
          // `framing` is an enum, so zod's message interpolates the received
          // value verbatim. That is what gives the assertion below teeth.
          connection_config: { host: "10.0.0.5", port: 502, framing: "s3cr3t-value-9f2a" },
        }),
      ],
      makeOptions(),
    );
    const detail = skipped[0].detail ?? "";
    assert(skipped[0].reason === "invalid-connection-config", "an unparseable config is reported");
    assert(detail.includes("framing"), `the failing path must be named, got "${detail}"`);
    // A zod message echoes the offending value, and a connection config sits one
    // field away from a credential (AGENTS.md §9.6). Report paths and codes.
    assert(
      !detail.includes("s3cr3t-value-9f2a"),
      `validation detail must not echo stored values, got "${detail}"`,
    );
  }

  // ---- credentials ---------------------------------------------------------

  {
    // MQTT takes the pilot-era path: rtu-config.js's own resolver, host-side.
    // ADR 0016 Resolved decision 5 — no RTU has a config row, so env is the
    // only working credential path today.
    const { endpoints } = planEndpoints([row()], makeOptions());
    assert(
      endpoints[0].credentials.username === "env-user" &&
        endpoints[0].credentials.password === "env-secret",
      "the MQTT env fallback must be applied by the host, never by the adapter",
    );
  }

  {
    // Every other protocol takes the ADR 0012 path and gets no env fallback.
    const { endpoints } = planEndpoints(
      [
        row({
          config_protocol: "modbus_tcp",
          connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
          credentials_ciphertext: Buffer.from("cipher"),
          credentials_iv: Buffer.from("iv"),
        }),
      ],
      makeOptions(),
    );
    assert(
      endpoints[0].credentials.password === "db-secret",
      "a non-MQTT adapter's credentials come from decryptCredentials alone",
    );
  }

  {
    // No key configured means no decryption attempt at all.
    const { endpoints } = planEndpoints(
      [
        row({
          config_protocol: "modbus_tcp",
          connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
          credentials_ciphertext: Buffer.from("cipher"),
          credentials_iv: Buffer.from("iv"),
        }),
      ],
      makeOptions({
        credentialKeyConfigured: false,
        decryptCredentials: () => {
          throw new Error("decryptCredentials must not be called without a key");
        },
      }),
    );
    assert(
      Object.keys(endpoints[0].credentials).length === 0,
      "without CREDENTIAL_ENCRYPTION_KEY there are simply no credentials",
    );
  }

  {
    // A decryption failure is one RTU's problem. The thrown error is discarded
    // rather than attached — a crypto error message can carry key material or
    // ciphertext framing.
    const { endpoints, skipped } = planEndpoints(
      [
        row({
          config_protocol: "modbus_tcp",
          connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
          credentials_ciphertext: Buffer.from("cipher"),
          credentials_iv: Buffer.from("iv"),
        }),
        row({ rtu_id: "rtu-uuid-2", rtu_code: "RTU-2" }),
      ],
      makeOptions({
        decryptCredentials: () => {
          throw new Error("Unsupported state or unable to authenticate data");
        },
      }),
    );
    assert(
      skipped.some((s) => s.reason === "credential-decrypt-failed"),
      "a decrypt failure must be reported",
    );
    assert(
      !JSON.stringify(skipped).includes("authenticate"),
      "the crypto error message must not be propagated",
    );
    assert(endpoints.length === 1, "the healthy MQTT RTU must survive a sibling's decrypt failure");
  }

  {
    // `decryptCredentials` ends in JSON.parse, so the plaintext can hold
    // anything. AdapterContext.credentials is Record<string, string>.
    const { endpoints, skipped } = planEndpoints(
      [
        row({
          config_protocol: "modbus_tcp",
          connection_config: { host: "10.0.0.5", port: 502, device: { unitId: 1 } },
          credentials_ciphertext: Buffer.from("cipher"),
          credentials_iv: Buffer.from("iv"),
        }),
      ],
      makeOptions({
        decryptCredentials: () => ({ username: "u", port: 502, token: null, password: "p" }),
      }),
    );
    const creds = endpoints[0].credentials;
    assert(
      creds.username === "u" && creds.password === "p",
      "string credentials survive the narrowing",
    );
    assert(
      !("port" in creds) && !("token" in creds),
      `non-string values must be dropped, got ${Object.keys(creds).join(",")}`,
    );
    const dropped = skipped.find((s) => s.reason === "non-string-credential-dropped");
    assert(dropped !== undefined, "dropped credential keys must be reported");
    assert(
      (dropped?.detail ?? "").includes("port") && (dropped?.detail ?? "").includes("token"),
      "the dropped keys are named",
    );
  }

  {
    // The sentinel scan that AGENTS.md §9.6 turns into a build gate: no
    // credential value may appear anywhere in the skip report.
    const sentinel = "sentinel-credential-value-4a7f";
    const { skipped } = planEndpoints(
      [
        row({ rtu_code: null }),
        row({ rtu_id: "r2", rtu_code: "R2", source_type: "catalog" }),
        row({
          rtu_id: "r3",
          rtu_code: "R3",
          config_protocol: "modbus_tcp",
          connection_config: { host: "10.0.0.5", port: 502, framing: "bad", device: { unitId: 1 } },
          credentials_ciphertext: Buffer.from("cipher"),
          credentials_iv: Buffer.from("iv"),
        }),
      ],
      makeOptions({
        decryptCredentials: () => ({ password: sentinel }),
        resolveMqttConnection: () => ({ ...ENV_CONNECTION, username: "u", password: sentinel }),
      }),
    );
    assert(
      !JSON.stringify(skipped).includes(sentinel),
      "no credential value may reach the skip report",
    );
  }

  // ---- the point index -----------------------------------------------------

  {
    // Two assets sharing one source_data_key — a shared meter feeding both a
    // plant asset and a header asset. A Map<string, target> would drop one.
    const { endpoints } = planEndpoints(
      [
        row({ asset_id: "asset-1", point_key: "TOTALISER", source_data_key: "tot" }),
        row({ asset_id: "asset-2", point_key: "INLET_TOTAL", source_data_key: "tot" }),
        row({ asset_id: "asset-1", point_key: "FLOW_RATE", source_data_key: "flow" }),
      ],
      makeOptions(),
    );
    const index = endpoints[0].pointIndex.get("RTU-1");
    assert(index !== undefined, "the index is keyed by deviceKey");
    const shared = index?.get("tot") ?? [];
    assert(shared.length === 2, `a shared source key must fan out, got ${shared.length}`);
    assert(
      shared.map((t) => t.pointKey).sort().join(",") === "INLET_TOTAL,TOTALISER",
      "both destinations are recorded",
    );
    assert((index?.get("flow") ?? []).length === 1, "an unshared source key has one target");
  }

  {
    // `sourceKeys` is what the adapter scopes its read set to, so it must be
    // de-duplicated and complete.
    const { endpoints } = planEndpoints(
      [
        row({ asset_id: "asset-1", source_data_key: "tot" }),
        row({ asset_id: "asset-2", source_data_key: "tot" }),
        row({ asset_id: "asset-1", source_data_key: "flow" }),
      ],
      makeOptions(),
    );
    const keys = [...endpoints[0].bindings[0].sourceKeys].sort();
    assert(keys.join(",") === "flow,tot", `wrong source keys: ${keys.join(",")}`);
  }

  {
    // Two RTUs on one endpoint each get their own index entry — the
    // "only the first row counts" bug ADR 0016 §9 asks to be caught at build
    // time.
    const { endpoints } = planEndpoints(
      [
        row(),
        row({ rtu_id: "rtu-uuid-2", rtu_code: "RTU-2", asset_id: "asset-2", source_data_key: "press" }),
      ],
      makeOptions(),
    );
    assert(endpoints[0].pointIndex.size === 2, "every device on the endpoint is indexed");
    assert(
      (endpoints[0].pointIndex.get("RTU-2")?.get("press") ?? []).length === 1,
      "the second RTU's points must not be dropped",
    );
  }

  // ---- an empty database yields an empty plan, not an error ----------------

  {
    const { endpoints, skipped } = planEndpoints([], makeOptions());
    assert(endpoints.length === 0 && skipped.length === 0, "no rows means no work, not a throw");
  }
}
