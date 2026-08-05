import { INGEST_PROTOCOLS, type IngestProtocol } from "@bms/shared/ingest";

import type { IngestAdapterFactory, RtuBinding } from "../adapter/types.js";
import type { PointIndex, PointTarget } from "./normaliser.js";

/**
 * Turning database rows into endpoint plans (ADR 0016 §3, §4).
 *
 * `loadBindingRows` is the one query; `planEndpoints` is a **pure** function
 * from rows to plans, so every interesting decision — protocol resolution,
 * schema validation, the MQTT compatibility shims, endpoint grouping, the
 * point-lookup index — is testable with no database at all.
 */

/**
 * One row of the binding query: an RTU × one of its mapped points, with the
 * RTU's connection config attached.
 *
 * Field names mirror the SQL columns rather than repository conventions,
 * because that is what makes a mismatch between this type and the query visible
 * when reading them side by side.
 */
export type BindingRow = {
  readonly rtu_id: string;
  /** Nullable in the schema; an RTU without one cannot be bound — see `planEndpoints`. */
  readonly rtu_code: string | null;
  readonly source_type: string;
  readonly mqtt_topic: string | null;
  readonly asset_id: string;
  /** `assets.meta->>'telemetrySource'`; `null` when the asset carries no meta. */
  readonly telemetry_source: string | null;
  readonly point_key: string;
  readonly source_data_key: string;
  readonly unit: string | null;
  /** `rtu_connection_configs.protocol`; `null` when the RTU has no config row. */
  readonly config_protocol: string | null;
  readonly connection_config: unknown;
  readonly credentials_ciphertext: Buffer | null;
  readonly credentials_iv: Buffer | null;
};

/**
 * The binding query.
 *
 * **The source axis is `asset_points.rtu_id`, not `assets.rtu_id`** — ADR 0018
 * decision 3 moved telemetry provenance down to the point so one asset can mix
 * measured, manual and computed points, and ADR 0018's Consequences names
 * `apps/ingest` as owing the change. `index.js` still joins the old
 * asset-level axis; the two agree on every current row because migration
 * `0023_source_axis_separation.sql` backfilled `asset_points.rtu_id` from
 * `assets.rtu_id`, so the ADR 0016 §6 parallel run still compares like with
 * like. ADR 0016 §3 is silent on this axis — the `LEFT JOIN` it mentions is
 * the one onto `rtu_connection_configs`, which is kept below because the pilot
 * RTU has no config row.
 *
 * `source_kind = 'measured'` is what excludes hand-entered (`F1.8`) and derived
 * points. The CHECK constraint guarantees `measured` implies a non-null
 * `rtu_id`, so the join and the filter cannot disagree.
 *
 * `telemetrySource` is deliberately **not** filtered here — see `planEndpoints`.
 */
export const BINDING_QUERY = `
  SELECT
    r.id AS rtu_id,
    r.rtu_code,
    r.source_type,
    r.mqtt_topic,
    a.id AS asset_id,
    a.meta->>'telemetrySource' AS telemetry_source,
    ap.point_key,
    ap.source_data_key,
    ap.unit,
    c.protocol AS config_protocol,
    c.config AS connection_config,
    c.credentials_ciphertext,
    c.credentials_iv
  FROM bms.rtus r
  INNER JOIN bms.asset_points ap
          ON ap.rtu_id = r.id
         AND ap.active = true
         AND ap.source_kind = 'measured'
  INNER JOIN bms.assets a ON a.id = ap.asset_id
  LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id
  WHERE r.ingest_enabled = true
  ORDER BY r.id, ap.point_key
`;

/** Why an RTU or a point was left out, so nothing is dropped silently. */
export type SkippedBinding = {
  readonly rtuId: string;
  readonly rtuCode: string | null;
  readonly reason: string;
  /** Free-form context. **Never** carries a credential value. */
  readonly detail?: string;
};

/** One adapter instance's worth of work. */
export type EndpointPlan = {
  readonly protocol: IngestProtocol;
  readonly endpointKey: string;
  /** Validated against the factory's `configSchema`. */
  readonly config: unknown;
  /** Plaintext, already decrypted. Never log, never echo, never persist. */
  readonly credentials: Readonly<Record<string, string>>;
  readonly bindings: readonly RtuBinding<unknown>[];
  /** `deviceKey → sourceKey → targets`, the host's own lookup (ADR 0016 §2). */
  readonly pointIndex: PointIndex;
};

export type PlanResult = {
  readonly endpoints: readonly EndpointPlan[];
  readonly skipped: readonly SkippedBinding[];
};

/** Decrypts one RTU's credential blob. Injected so tests need no encryption key. */
export type CredentialDecryptor = (
  ciphertext: Buffer,
  iv: Buffer,
) => Record<string, unknown>;

/**
 * The pilot-era MQTT connection resolver — `resolveMqttConnection` from
 * `apps/ingest/src/rtu-config.js`, injected rather than imported so the planner
 * stays pure and testable.
 */
export type MqttConnectionResolver = (configRow: {
  config: unknown;
  credentials_ciphertext: Buffer | null;
  credentials_iv: Buffer | null;
} | null) => {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type PlanOptions = {
  /** Registry lookup. Passing it in keeps this module independent of `registry.ts`. */
  readonly lookup: (protocol: IngestProtocol) => IngestAdapterFactory | undefined;
  readonly decryptCredentials: CredentialDecryptor;
  readonly resolveMqttConnection: MqttConnectionResolver;
  /** True when `CREDENTIAL_ENCRYPTION_KEY` is set; a false value skips decryption entirely. */
  readonly credentialKeyConfigured: boolean;
  /**
   * Connection settings the host reads from the environment for MQTT alone.
   *
   * `index.js` honours `MQTT_TLS_REJECT_UNAUTHORIZED`, and the PHE broker is
   * the reason that escape hatch exists. The adapter may not read it (§4), and
   * dropping it would mean a TLS failure the moment the host runs against a
   * pilot configured with it — during the parallel-run window, which is
   * precisely when nothing may break. Merged *under* the stored JSONB, so a
   * value written to `rtu_connection_configs.config` always wins over the
   * environment. MQTT only; new adapters get no environment fallback at all.
   */
  readonly mqttConnectionDefaults?: Readonly<Record<string, unknown>>;
};

/**
 * The identity of one supervised endpoint: `(protocol, endpointKey)`.
 *
 * Exported because `main.ts` keys its supervisor and point-index maps by the
 * same thing, and two independent format strings that must agree is a bug
 * waiting to be written. It very nearly was: this was originally a template
 * literal here and a differently-separated one there.
 *
 * The separator is `\u0000`, written as an escape rather than as a literal
 * byte — a literal NUL makes the source file binary to git, so the diff stops
 * being reviewable. NUL is the right value because it cannot occur in a
 * protocol name or an endpoint key, so `a:b` + `c` and `a` + `b:c` cannot
 * collide the way a `:` or a space would let them.
 */
export function endpointGroupKey(protocol: IngestProtocol, endpointKey: string): string {
  return `${protocol}\u0000${endpointKey}`;
}

function isIngestProtocol(value: string): value is IngestProtocol {
  return (INGEST_PROTOCOLS as readonly string[]).includes(value);
}

/**
 * Keeps only string-valued entries.
 *
 * `decryptCredentials` ends in `JSON.parse`, so the plaintext can hold anything
 * the API wrote. `AdapterContext.credentials` is `Record<string, string>`, and
 * a number leaking through as a `string` at the type level is the kind of lie
 * that surfaces as an unreadable protocol error three layers down. Dropped keys
 * are reported by name; **values never appear anywhere** (AGENTS.md §9.6).
 */
function narrowCredentials(raw: Record<string, unknown>): {
  credentials: Record<string, string>;
  droppedKeys: string[];
} {
  const credentials: Record<string, string> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      credentials[key] = value;
    } else {
      droppedKeys.push(key);
    }
  }
  return { credentials, droppedKeys };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Splits `rtu_connection_configs.config` into the connection slice and the
 * device slice (ADR 0016 §3).
 *
 * The JSONB holds both: everything except `device` is connection-level (host,
 * port, timeouts) and `config.device` is per-device (Modbus unit id, OPC-UA
 * node prefix). That is the split the data already has.
 */
function splitConfig(raw: unknown): {
  connection: Record<string, unknown>;
  device: Record<string, unknown>;
} {
  const all = asRecord(raw);
  const { device, ...connection } = all;
  return { connection, device: asRecord(device) };
}

/**
 * Groups rows into one plan per `(protocol, endpointKey)`.
 *
 * Pure: no database, no clock, no `process.env`. Everything it needs arrives in
 * `options`.
 */
export function planEndpoints(rows: readonly BindingRow[], options: PlanOptions): PlanResult {
  const skipped: SkippedBinding[] = [];
  const byRtu = new Map<string, BindingRow[]>();
  for (const row of rows) {
    const existing = byRtu.get(row.rtu_id);
    if (existing === undefined) {
      byRtu.set(row.rtu_id, [row]);
    } else {
      existing.push(row);
    }
  }

  type Accumulator = {
    protocol: IngestProtocol;
    endpointKey: string;
    config: unknown;
    credentials: Record<string, string>;
    bindings: RtuBinding<unknown>[];
    index: Map<string, Map<string, PointTarget[]>>;
  };
  const endpoints = new Map<string, Accumulator>();

  for (const [rtuId, rtuRows] of byRtu) {
    const head = rtuRows[0];

    // `protocol := rtu_connection_configs.protocol ?? rtus.source_type` (§3).
    // `source_type` defaults to 'catalog', which is not an ingest protocol —
    // that is the ordinary case for the 40 synthetic RTUs ADR 0018 describes,
    // and it is why an unknown protocol is skipped rather than thrown on.
    const protocolName = head.config_protocol ?? head.source_type;
    if (!isIngestProtocol(protocolName)) {
      skipped.push({
        rtuId,
        rtuCode: head.rtu_code,
        reason: "unsupported-protocol",
        detail: protocolName,
      });
      continue;
    }
    const protocol: IngestProtocol = protocolName;

    const factory = options.lookup(protocol);
    if (factory === undefined) {
      // A protocol in the union with no adapter yet — every one but `mqtt`
      // until the F1.2–F1.6 fan-out lands. Logged once per RTU, never thrown.
      skipped.push({ rtuId, rtuCode: head.rtu_code, reason: "no-adapter", detail: protocol });
      continue;
    }

    // `deviceKey` resolves to `rtus.rtu_code` (§3) — the existing routing key,
    // which the PHE payload's `dev_id` is matched against. It is nullable in
    // the schema, and inventing a substitute would mean listening for a device
    // identifier the wire never sends. Skip and say so instead.
    if (head.rtu_code === null || head.rtu_code === "") {
      skipped.push({ rtuId, rtuCode: null, reason: "missing-rtu-code" });
      continue;
    }
    const deviceKey = head.rtu_code;

    // **The `telemetrySource` filter is scoped to MQTT**, exactly as the
    // `mqtt_topic` device shim below is (§3). `index.js:82` applies
    // `COALESCE(a.meta->>'telemetrySource','mqtt') = 'mqtt'` unconditionally,
    // which is right for a single-protocol process: it is the mutual exclusion
    // that stops `apps/sim` and ingest writing the same asset. Lifting it into
    // a multi-protocol query unchanged would silently drop every point on a
    // Modbus RTU whose assets are marked `catalog`. Behaviour is identical for
    // the pilot today, where `mqtt` is the only protocol with `ingest_enabled`.
    const pointRows =
      protocol === "mqtt"
        ? rtuRows.filter((row) => (row.telemetry_source ?? "mqtt") === "mqtt")
        : rtuRows;
    if (pointRows.length === 0) {
      skipped.push({ rtuId, rtuCode: deviceKey, reason: "no-mqtt-owned-points" });
      continue;
    }

    // ---- config -----------------------------------------------------------

    const { connection, device } = splitConfig(head.connection_config);
    let connectionSlice: Record<string, unknown> = connection;
    let credentials: Record<string, string> = {};

    if (protocol === "mqtt") {
      // Pilot-era compatibility path (§4). The adapter may never read
      // `process.env` — for a secret *or* for a connection setting — so the
      // env fallback lives here, in the host, scoped to MQTT alone. It is
      // `rtu-config.js`'s own resolver rather than a reimplementation because
      // that file is unmodified through the whole strangler (§6) and its
      // credential precedence is what the live pilot runs on today. ADR 0016
      // Resolved decision 5: no RTU currently has a `rtu_connection_configs`
      // row, so this is the *only* working credential path right now.
      // **Refuse a stored request to disable TLS verification.**
      //
      // `connection` is untrusted JSONB spread over the environment defaults, so
      // without this a `{"rejectUnauthorized": false}` row would reach
      // `mqtt.connect()` with certificate validation off — and the same JSONB
      // also supplies `host`. Whoever can write that row could therefore point
      // the endpoint at a broker of their choosing *and* stop the host checking
      // its certificate, at which point the decrypted broker credentials are
      // handed straight to it. `rtu_connection_configs.config` is writable
      // through the ADR 0011 onboarding commit by an `organization_admin`, not
      // only by a platform operator.
      //
      // This is new surface: `index.js:204` reads `rejectUnauthorized` from the
      // environment alone, and ADR 0016 Amendment 1 justifies the schema field
      // solely as carrying *that* behaviour. So the environment stays the only
      // way to lower it, and a row that asks is refused rather than ignored —
      // failing closed and visibly, because a silently-dropped security setting
      // teaches the next reader that the row works.
      if (Object.prototype.hasOwnProperty.call(connection, "rejectUnauthorized")) {
        skipped.push({ rtuId, rtuCode: deviceKey, reason: "tls-downgrade-refused" });
        continue;
      }

      let resolved: ReturnType<MqttConnectionResolver>;
      try {
        resolved = options.resolveMqttConnection(
          head.connection_config === null && head.credentials_ciphertext === null
            ? null
            : {
                config: head.connection_config,
                credentials_ciphertext: head.credentials_ciphertext,
                credentials_iv: head.credentials_iv,
              },
        );
      } catch {
        // `resolveMqttConnection` decrypts, so it throws on a wrong-length IV, a
        // bad GCM tag, a truncated ciphertext or a rotated encryption key. This
        // guard was missing while the non-MQTT branch below had one — and
        // `planEndpoints` is called unguarded from `main.ts`, so the throw
        // reached `main().catch` and exited the process. One bad credential blob
        // on one RTU would have stopped *every* endpoint and put the container
        // in a restart loop, against §3 ("It never throws") and §5's blast-radius
        // criterion. The error is not attached: crypto messages can carry key
        // material or ciphertext framing (AGENTS.md §9.6).
        skipped.push({ rtuId, rtuCode: deviceKey, reason: "credential-decrypt-failed" });
        continue;
      }

      connectionSlice = {
        ...options.mqttConnectionDefaults,
        ...connection,
        host: resolved.host,
        port: resolved.port,
      };
      if (resolved.username !== undefined) {
        credentials.username = resolved.username;
      }
      if (resolved.password !== undefined) {
        credentials.password = resolved.password;
      }
    } else if (
      head.credentials_ciphertext !== null &&
      head.credentials_iv !== null &&
      options.credentialKeyConfigured
    ) {
      // Every other protocol takes the ADR 0012 path and nothing else: no env
      // fallback at all, for any new adapter (§4).
      try {
        const plaintext = options.decryptCredentials(
          head.credentials_ciphertext,
          head.credentials_iv,
        );
        const narrowed = narrowCredentials(asRecord(plaintext));
        credentials = narrowed.credentials;
        if (narrowed.droppedKeys.length > 0) {
          skipped.push({
            rtuId,
            rtuCode: deviceKey,
            reason: "non-string-credential-dropped",
            detail: narrowed.droppedKeys.join(","),
          });
        }
      } catch {
        // The error is deliberately not attached — a decryption failure message
        // can carry key material or ciphertext framing (AGENTS.md §9.6).
        skipped.push({ rtuId, rtuCode: deviceKey, reason: "credential-decrypt-failed" });
        continue;
      }
    }

    const configParsed = factory.configSchema.safeParse(connectionSlice);
    if (!configParsed.success) {
      skipped.push({
        rtuId,
        rtuCode: deviceKey,
        reason: "invalid-connection-config",
        // Paths only. A zod message can echo the offending value, and this
        // config is one field away from a credential.
        detail: configParsed.error.issues.map((i) => i.path.join(".") || "(root)").join(","),
      });
      continue;
    }

    // ---- device slice -----------------------------------------------------

    // F1.1 introduces no migration, so `mqtt_topic` is still a column on
    // `bms.rtus`. One compatibility shim, scoped to MQTT only, with a written
    // `device.topic` winning once it exists (§3). Backfilling the column and
    // retiring it is owed follow-up, not F1.1.
    const deviceSlice =
      protocol === "mqtt" ? { topic: head.mqtt_topic, ...device } : device;

    const deviceParsed = factory.deviceSchema.safeParse(deviceSlice);
    if (!deviceParsed.success) {
      skipped.push({
        rtuId,
        rtuCode: deviceKey,
        reason: "invalid-device-config",
        detail: deviceParsed.error.issues.map((i) => i.path.join(".") || "(root)").join(","),
      });
      continue;
    }

    // ---- grouping ---------------------------------------------------------

    const endpointKey = factory.endpointKey(configParsed.data, rtuId);
    const groupKey = endpointGroupKey(protocol, endpointKey);
    let group = endpoints.get(groupKey);
    if (group === undefined) {
      group = {
        protocol,
        endpointKey,
        config: configParsed.data,
        credentials,
        bindings: [],
        index: new Map(),
      };
      endpoints.set(groupKey, group);
    } else if (Object.keys(credentials).length > 0 && Object.keys(group.credentials).length === 0) {
      // First non-empty set wins, rather than the first row outright. This is
      // the `activeMqttConnection` singleton bug from `index.js` narrowed but
      // not cured: RTUs that share an endpoint but need *different* credentials
      // still cannot be expressed. `F1.7` owns the per-RTU credential story;
      // ADR 0016 §Consequences says so explicitly. Recorded rather than hidden.
      group.credentials = credentials;
    } else if (
      Object.keys(credentials).length > 0 &&
      JSON.stringify(Object.keys(credentials).sort()) !==
        JSON.stringify(Object.keys(group.credentials).sort())
    ) {
      skipped.push({
        rtuId,
        rtuCode: deviceKey,
        reason: "endpoint-credential-conflict",
        detail: endpointKey,
      });
    }

    const sourceKeys = [...new Set(pointRows.map((row) => row.source_data_key))];
    group.bindings.push({
      rtuId,
      rtuCode: deviceKey,
      deviceKey,
      device: deviceParsed.data,
      sourceKeys,
    });

    let bySourceKey = group.index.get(deviceKey);
    if (bySourceKey === undefined) {
      bySourceKey = new Map();
      group.index.set(deviceKey, bySourceKey);
    }
    for (const row of pointRows) {
      const targets = bySourceKey.get(row.source_data_key);
      const target: PointTarget = {
        assetId: row.asset_id,
        pointKey: row.point_key,
        unit: row.unit,
      };
      if (targets === undefined) {
        bySourceKey.set(row.source_data_key, [target]);
      } else {
        targets.push(target);
      }
    }
  }

  return {
    endpoints: [...endpoints.values()].map((group) => ({
      protocol: group.protocol,
      endpointKey: group.endpointKey,
      config: group.config,
      credentials: group.credentials,
      bindings: group.bindings,
      pointIndex: group.index,
    })),
    skipped,
  };
}

/** The slice of a `pg` pool this module needs. */
export type BindingQueryable = {
  query(text: string): Promise<{ rows: BindingRow[] }>;
};

/** Runs `BINDING_QUERY`. Separated from `planEndpoints` so the planning is DB-free. */
export async function loadBindingRows(pool: BindingQueryable): Promise<BindingRow[]> {
  const result = await pool.query(BINDING_QUERY);
  return result.rows;
}
