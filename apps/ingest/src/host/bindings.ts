import { createHash } from "node:crypto";

import {
  INGEST_PROTOCOLS,
  MQTT_BUILTIN_PAYLOAD_FORMAT_CODE,
  MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION,
  mqttPayloadFormatDefinitionSchema,
  mqttPlaintextDecision,
  type IngestProtocol,
  type MqttPayloadFormatDefinition,
} from "@bms/shared/ingest";

import type { IngestAdapterFactory, RtuBinding } from "../adapter/types.js";
import {
  addEdgeServed,
  indexPointRows,
  type EdgeServed,
  type EdgeServedAccumulator,
} from "./binding-targets.js";
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
  /**
   * The five resolved point-metadata columns (ADR 0056 decision 1), each already
   * `coalesce`d in the query — see `BINDING_QUERY`. `null` is the resolved
   * value, not a missing one, and means today's behaviour.
   */
  readonly scale_multiplier: number | null;
  readonly scale_offset: number | null;
  readonly eng_min: number | null;
  readonly eng_max: number | null;
  /**
   * `varchar(16)` with a CHECK, not an enum type, so this is a `string` here and
   * `planEndpoints` narrows it — an older host may read a value a newer API
   * wrote.
   */
  readonly quality_policy: string | null;
  /** `rtu_connection_configs.protocol`; `null` when the RTU has no config row. */
  readonly config_protocol: string | null;
  readonly connection_config: unknown;
  readonly credentials_ciphertext: Buffer | null;
  readonly credentials_iv: Buffer | null;
  /**
   * `rtu_connection_configs.key_version` — which key encrypted this row's blob
   * (ADR 0062 decision 3).
   *
   * `null` **only** when the RTU has no config row at all: the column is
   * `integer not null default 1`, so the `LEFT JOIN` is the one thing that can
   * produce a null here. It arrives from `pg` as a JS `number`;
   * `bindings.integration.spec.ts` is the only gate for that, and
   * `keyForVersion` refuses anything that is not one.
   */
  readonly key_version: number | null;
  /** `organizations.code` of the RTU's organization — the skip detail (ADR 0115 decision 5). */
  readonly organization_code: string;
  /**
   * `organizations.ingest_enabled` (ADR 0115 decision 1). Selected, not
   * filtered: `planEndpoints` turns `false` into a named skip.
   */
  readonly organization_ingest_enabled: boolean;
  /**
   * `mqtt_payload_formats.code` joined on `config->>'payloadFormat'` (ADR 0116
   * decision 4). `null` when the config names no format **or** names one with
   * no catalog row; `planEndpoints` tells the two apart by reading the config.
   */
  readonly payload_format_code: string | null;
  /** `mqtt_payload_formats.definition`, unparsed; `planEndpoints` validates it. */
  readonly payload_format_definition: unknown;
  /**
   * `rtus.edge_gateway_id` (ADR 0123 decision 6, migration `0141`). Set: the edge
   * box serves the RTU and the cloud plan dials nothing for it (`edgeServed`).
   */
  readonly edge_gateway_id: string | null;
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
 *
 * ## The five resolved metadata columns (`F2.7` / ADR 0056 decisions 1 and 4)
 *
 * `scale_multiplier`, `scale_offset`, `eng_min`, `eng_max` and `quality_policy`
 * exist on **both** `template_points` (the class default) and `asset_points`
 * (the per-asset override), and the resolved value is
 * `coalesce(asset_points.<c>, template_points.<c>)` **per column** — ADR 0039
 * decision 6's rule for the calc-config columns on the same two tables, reused
 * rather than re-invented. Per column, so a partial override restates one field
 * rather than a whole point.
 *
 * A resolved `NULL` is a stated rule and not a missing value: multiplier `1`,
 * offset `0`, no range test, `discard_bad` — which is exactly what the host did
 * before `F2.7`, so every existing row reads as "unchanged".
 *
 * **The template join must stay a `LEFT JOIN`.** A hand-created asset has no
 * `template_id`, and an inner join would silently unbind every one of them —
 * including all 105 seeded PHE bindings, which is what
 * `bindings.integration.spec.ts`'s row count asserts.
 *
 * ## The organization switch (ADR 0115 decision 5)
 *
 * `bms.organizations` is joined so each row carries its organization's code and
 * `ingest_enabled`. It is an `INNER JOIN` because `rtus.organization_id` is
 * `NOT NULL` (migration `0047`), so it drops nothing. The organization switch is
 * **selected, never filtered**: `planEndpoints` skips a switched-off
 * organization's RTUs as `organization-ingest-disabled`, so the health body says
 * why each one is missing. Only the RTU's own box stays in the `WHERE`.
 *
 * ## The payload format (ADR 0116 decision 4, `F4.334`)
 *
 * `bms.mqtt_payload_formats` is a `LEFT JOIN` on the code the connection config
 * names, so the host holds the definition with the binding. An RTU whose config
 * names no format joins nothing and decodes with the built-in envelope in code —
 * it never needs the `thinkiot-envelope` row to exist. A named code with no row
 * reads as `null` and is skipped as `payload-format-unknown`.
 *
 * `F4.339` (ADR 0117 decision 8): `r.active = true` — an inactive RTU released
 * its MQTT topic, so it is not planned at all and has no skip reason.
 *
 * `E7.2` (ADR 0123 decision 6): `r.edge_gateway_id` is selected, never
 * filtered — `planEndpoints` moves an edge-served RTU into `edgeServed`.
 */
export const BINDING_QUERY = `
  SELECT
    r.id AS rtu_id,
    r.rtu_code,
    r.source_type,
    r.mqtt_topic,
    r.edge_gateway_id,
    a.id AS asset_id,
    a.meta->>'telemetrySource' AS telemetry_source,
    ap.point_key,
    ap.source_data_key,
    ap.unit,
    coalesce(ap.scale_multiplier, tp.scale_multiplier) AS scale_multiplier,
    coalesce(ap.scale_offset, tp.scale_offset) AS scale_offset,
    coalesce(ap.eng_min, tp.eng_min) AS eng_min,
    coalesce(ap.eng_max, tp.eng_max) AS eng_max,
    coalesce(ap.quality_policy, tp.quality_policy) AS quality_policy,
    c.protocol AS config_protocol,
    c.config AS connection_config,
    c.credentials_ciphertext,
    c.credentials_iv,
    c.key_version,
    o.code AS organization_code,
    o.ingest_enabled AS organization_ingest_enabled,
    f.code AS payload_format_code,
    f.definition AS payload_format_definition
  FROM bms.rtus r
  INNER JOIN bms.organizations o ON o.id = r.organization_id
  INNER JOIN bms.asset_points ap
          ON ap.rtu_id = r.id
         AND ap.active = true
         AND ap.source_kind = 'measured'
  INNER JOIN bms.assets a ON a.id = ap.asset_id
  LEFT JOIN bms.template_points tp
         ON tp.template_id = a.template_id
        AND tp.point_key = ap.point_key
  LEFT JOIN bms.rtu_connection_configs c ON c.rtu_id = r.id
  LEFT JOIN bms.mqtt_payload_formats f ON f.code = c.config->>'payloadFormat'
  WHERE r.ingest_enabled = true
    AND r.active = true
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
  /**
   * sha256 over the sorted `topic, format code, definition` of every binding
   * (ADR 0116 decision 6, plan R8). A reload whose device set is unchanged but
   * whose fingerprint differs replaces the endpoint, so a format edit reaches a
   * running connection without a restart. Built from non-secret fields only:
   * credentials stay unfingerprinted (ADR 0115 R5). Non-MQTT plans hash an
   * empty list.
   */
  readonly decoderFingerprint: string;
};

/**
 * An RTU that is served, but not with what its row says (`E8.4`, ADR 0062
 * decision 9).
 *
 * Separate from `SkippedBinding` because nothing was dropped: the endpoint runs
 * and the telemetry flows. It is the *fail-open* report — a config row exists
 * and the process still connected with the environment's credential — and
 * folding it into `skipped` would make an operator reading the skip list
 * believe the RTU is down.
 */
export type PlanWarning = {
  readonly rtuId: string;
  /** `string | null` to match `SkippedBinding`; non-null on every current path. */
  readonly rtuCode: string | null;
  readonly reason: "credential-env-fallback";
};

export type PlanResult = {
  readonly endpoints: readonly EndpointPlan[];
  readonly skipped: readonly SkippedBinding[];
  readonly warnings: readonly PlanWarning[];
  /**
   * RTUs whose `edge_gateway_id` is set, by gateway (ADR 0123 decision 6, plan
   * C5). In no endpoint and in no `skipped` list: nothing was dropped, the edge
   * writes them. The cloud receiver accepts a sample only for these device keys.
   */
  readonly edgeServed: EdgeServed;
};

/**
 * Decrypts one RTU's credential blob **at the version the row stores** (ADR
 * 0062 decisions 3 and 4). Injected so tests need no encryption key.
 *
 * The third parameter is `rtu_connection_configs.key_version`, passed through
 * unchanged — no `?? 1`. A blob whose version no loaded key writes must be
 * refused, and defaulting it here would restore exactly the guess decision 4
 * forbids.
 */
export type CredentialDecryptor = (
  ciphertext: Buffer,
  iv: Buffer,
  keyVersion: number | null,
) => Record<string, unknown>;

/**
 * The pilot-era MQTT connection resolver — `resolveMqttConnection` from
 * `apps/ingest/src/rtu-config.js`, injected rather than imported so the planner
 * stays pure and testable.
 *
 * `credentialSource` is `"db"` only when a credential came out of the decrypted
 * blob. It is **not** the same question as that function's `source`, which
 * reports whether a config row existed — see its docblock.
 */
export type MqttConnectionResolver = (configRow: {
  config: unknown;
  credentials_ciphertext: Buffer | null;
  credentials_iv: Buffer | null;
  key_version: number | null;
} | null) => {
  host: string;
  port: number;
  username?: string;
  password?: string;
  credentialSource: "db" | "env";
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
  /**
   * `MQTT_PLAINTEXT_HOSTS`, parsed (ADR 0114 decision 1). Absent is the empty
   * set — fail closed: no `tls: false` RTU is served.
   */
  readonly mqttPlaintextHosts?: ReadonlySet<string>;
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

/**
 * The one credential-failure cause worth naming to an operator: the row was
 * encrypted under a key this process does not hold (ADR 0062 decision 4).
 *
 * **A constant, never `err.message`.** §9.6 keeps crypto text out of the skip
 * report because it can carry key material or ciphertext framing, and the
 * report is served on the health endpoint. A fixed token also keeps the
 * vocabulary closed, so an operator can grep for it. Every other failure — a
 * wrong-length IV, a bad tag, a truncated ciphertext — carries no detail at
 * all, which is why this returns an empty object rather than a second string.
 *
 * Matched on `name` rather than `instanceof`: vitest can load two module
 * instances of `@bms/shared` (`F4.108`), and the ingest host loads the built
 * `dist` while a spec may load the source.
 */
function keyVersionDetail(error: unknown): { detail?: string } {
  const name =
    typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === "CredentialKeyVersionError" ? { detail: "key-version-not-loaded" } : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Whether two parsed connection configs dial the same broker the same way (F4.326 review M1). */
function sameConnection(a: unknown, b: unknown): boolean {
  const x = asRecord(a);
  const y = asRecord(b);
  return x.host === y.host && x.port === y.port && x.tls === y.tls;
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

/** The payload format one MQTT binding decodes with; `undefined` is the built-in. */
type ResolvedPayloadFormat = { code: string; definition: MqttPayloadFormatDefinition } | undefined;

/**
 * Resolves the format an MQTT RTU's config names against the catalog join
 * (ADR 0116 decision 4, plan R4). The skip details are the code — a kebab-case
 * token the config schema has already checked — never the definition.
 */
function resolvePayloadFormat(
  connection: Record<string, unknown>,
  head: BindingRow,
): { format: ResolvedPayloadFormat } | { skip: "payload-format-unknown" | "payload-format-invalid"; code: string } {
  const code = connection.payloadFormat;
  if (typeof code !== "string") {
    return { format: undefined };
  }
  if (head.payload_format_code === null) {
    return { skip: "payload-format-unknown", code };
  }
  const parsed = mqttPayloadFormatDefinitionSchema.safeParse(head.payload_format_definition);
  if (!parsed.success) {
    return { skip: "payload-format-invalid", code };
  }
  return { format: { code: head.payload_format_code, definition: parsed.data } };
}

/** `decoderFingerprint` for one endpoint's bindings (plan R8). */
function decoderFingerprint(protocol: IngestProtocol, bindings: readonly RtuBinding<unknown>[]): string {
  const parts =
    protocol === "mqtt"
      ? bindings.map((binding) => {
          const device = asRecord(binding.device);
          const format = device.payloadFormat as ResolvedPayloadFormat;
          return [
            String(device.topic),
            format?.code ?? MQTT_BUILTIN_PAYLOAD_FORMAT_CODE,
            JSON.stringify(format?.definition ?? MQTT_BUILTIN_PAYLOAD_FORMAT_DEFINITION),
          ].join("\u0000");
        })
      : [];
  return createHash("sha256").update([...new Set(parts)].sort().join("\n")).digest("hex");
}

/**
 * Groups rows into one plan per `(protocol, endpointKey)`.
 *
 * Pure: no database, no clock, no `process.env`. Everything it needs arrives in
 * `options`.
 */
export function planEndpoints(rows: readonly BindingRow[], options: PlanOptions): PlanResult {
  const skipped: SkippedBinding[] = [];
  const warnings: PlanWarning[] = [];
  const edgeServed: EdgeServedAccumulator = new Map();
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
    /** `topic → format code` on this endpoint, for `payload-format-conflict`. */
    formatByTopic: Map<string, string>;
  };
  const endpoints = new Map<string, Accumulator>();

  // F4.334 security review M1: RTUs whose topic is their own `rtus.mqtt_topic`
  // (globally unique) are planned before RTUs that borrow a topic through a
  // stored `config.device.topic`, so every first-wins rule on a shared topic
  // favours the owner. A stable partition: the order within each half is kept.
  const borrows = (rows: readonly BindingRow[]): boolean =>
    typeof asRecord(asRecord(rows[0]?.connection_config).device).topic === "string";
  const byOwnTopicFirst = [
    ...[...byRtu].filter(([, rows]) => !borrows(rows)),
    ...[...byRtu].filter(([, rows]) => borrows(rows)),
  ];

  for (const [rtuId, rtuRows] of byOwnTopicFirst) {
    const head = rtuRows[0];

    // ADR 0115 decisions 2 and 5: an RTU is ingested only when its own box *and*
    // its organization's switch are on. Decided **first** (plan R4), so a
    // switched-off organization's RTU with a broken config reports the one
    // reason the operator can act on. The detail is the organization code,
    // `^[A-Z0-9_-]+$` by the API's schema, so it carries nothing secret.
    if (!head.organization_ingest_enabled) {
      skipped.push({
        rtuId,
        rtuCode: head.rtu_code,
        reason: "organization-ingest-disabled",
        detail: head.organization_code,
      });
      continue;
    }

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

    // ADR 0123 decision 6, plan C5: one writer per RTU. An edge-served RTU is
    // decided here — after the organization switch, the protocol, `rtu_code` and
    // the `telemetrySource` filter, so those still skip it by name; before config
    // and credentials, so the cloud never decrypts a blob or dials a broker for
    // a device the edge serves.
    if (head.edge_gateway_id !== null) {
      addEdgeServed(edgeServed, head.edge_gateway_id, rtuId, deviceKey, pointRows);
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

      // Hoisted rather than inlined at the call: the warning below has to know
      // whether a config row existed, and re-deriving that condition twice is
      // how the two answers drift apart.
      const configRow =
        head.connection_config === null && head.credentials_ciphertext === null
          ? null
          : {
              config: head.connection_config,
              credentials_ciphertext: head.credentials_ciphertext,
              credentials_iv: head.credentials_iv,
              key_version: head.key_version,
            };

      let resolved: ReturnType<MqttConnectionResolver>;
      try {
        resolved = options.resolveMqttConnection(configRow);
      } catch (error) {
        // `resolveMqttConnection` decrypts, so it throws on a wrong-length IV, a
        // bad GCM tag, a truncated ciphertext or a rotated encryption key. This
        // guard was missing while the non-MQTT branch below had one — and
        // `planEndpoints` is called unguarded from `main.ts`, so the throw
        // reached `main().catch` and exited the process. One bad credential blob
        // on one RTU would have stopped *every* endpoint and put the container
        // in a restart loop, against §3 ("It never throws") and §5's blast-radius
        // criterion. The error is not attached: crypto messages can carry key
        // material or ciphertext framing (AGENTS.md §9.6).
        skipped.push({
          rtuId,
          rtuCode: deviceKey,
          reason: "credential-decrypt-failed",
          ...keyVersionDetail(error),
        });
        continue;
      }

      connectionSlice = {
        ...options.mqttConnectionDefaults,
        ...connection,
        host: resolved.host,
        port: resolved.port,
      };

      // F4.326 security review M1: a host carrying `/` (e.g. a stored
      // `mqtt://other.example`) can never be dialled, and since ADR 0114 keys a
      // plain endpoint `mqtt://host:port` it would collide with one — joining a
      // plain connection while its own row says TLS, or breaking another
      // organization's. Refused by name before it can be grouped.
      if (resolved.host.includes("/")) {
        skipped.push({ rtuId, rtuCode: deviceKey, reason: "invalid-connection-config", detail: "host" });
        continue;
      }

      // ADR 0114 decision 3: plain MQTT only for a literal `tls: false` whose
      // host is on `MQTT_PLAINTEXT_HOSTS`. Read from the merged slice — what the
      // adapter will act on (security review L1) — and against `resolved.host`,
      // the host the connection will dial, which `MQTT_HOST` may have supplied,
      // never the stored `connection.host`. A refusal skips the RTU by name and
      // never falls back to TLS (ruling Q3): a silent TLS connect to a
      // plain-only broker is the failure ADR 0114 exists to remove.
      const transport = mqttPlaintextDecision(
        connectionSlice.tls,
        resolved.host,
        options.mqttPlaintextHosts ?? new Set<string>(),
      );
      if (transport === "refused") {
        skipped.push({ rtuId, rtuCode: deviceKey, reason: "plaintext-host-not-allowed" });
        continue;
      }

      // F4.326 security review M2: `resolveMqttConnection` seeds the username
      // and password from `MQTT_USERNAME`/`MQTT_PASSWORD` — the pilot broker's —
      // and replaces each only if the blob holds it. On a plain connection to a
      // host the row names itself, that would send the pilot credentials in
      // clear text to another broker. Only the row's own blob is used there; the
      // env credentials stay with the `MQTT_HOST` fallback broker they belong to.
      if (transport === "plain" && typeof connection.host === "string") {
        if (
          head.credentials_ciphertext !== null &&
          head.credentials_iv !== null &&
          options.credentialKeyConfigured
        ) {
          try {
            const own = asRecord(
              options.decryptCredentials(head.credentials_ciphertext, head.credentials_iv, head.key_version),
            );
            if (typeof own.username === "string") {
              credentials.username = own.username;
            }
            if (typeof own.password === "string") {
              credentials.password = own.password;
            }
          } catch (error) {
            skipped.push({
              rtuId,
              rtuCode: deviceKey,
              reason: "credential-decrypt-failed",
              ...keyVersionDetail(error),
            });
            continue;
          }
        }
      } else {
        // Decision 9: a row exists and the process still used the environment's
        // credential. Nothing is dropped — the endpoint runs — so this is a
        // warning rather than a skip, and it is the one signal that distinguishes
        // "the operator entered a credential" from "the operator entered one and
        // the host is not using it".
        if (configRow !== null && resolved.credentialSource === "env") {
          warnings.push({ rtuId, rtuCode: deviceKey, reason: "credential-env-fallback" });
        }
        if (resolved.username !== undefined) {
          credentials.username = resolved.username;
        }
        if (resolved.password !== undefined) {
          credentials.password = resolved.password;
        }
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
          head.key_version,
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
      } catch (error) {
        // The error is deliberately not attached — a decryption failure message
        // can carry key material or ciphertext framing (AGENTS.md §9.6).
        skipped.push({
          rtuId,
          rtuCode: deviceKey,
          reason: "credential-decrypt-failed",
          ...keyVersionDetail(error),
        });
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

    // ---- payload format (ADR 0116 decision 4) ----------------------------

    let payloadFormat: ResolvedPayloadFormat;
    if (protocol === "mqtt") {
      const resolved = resolvePayloadFormat(connection, head);
      if ("skip" in resolved) {
        skipped.push({ rtuId, rtuCode: deviceKey, reason: resolved.skip, detail: resolved.code });
        continue;
      }
      payloadFormat = resolved.format;
    }

    // ---- device slice -----------------------------------------------------

    // F1.1 introduces no migration, so `mqtt_topic` is still a column on
    // `bms.rtus`. One compatibility shim, scoped to MQTT only, with a written
    // `device.topic` winning once it exists (§3). Backfilling the column and
    // retiring it is owed follow-up, not F1.1.
    //
    // `payloadFormat` is set from the catalog join **last**, so a stored
    // `config.device.payloadFormat` can never supply its own definition — the
    // key is always overwritten, with `undefined` when the config names none.
    const deviceSlice =
      protocol === "mqtt" ? { topic: head.mqtt_topic, ...device, payloadFormat } : device;

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
        formatByTopic: new Map(),
      };
      endpoints.set(groupKey, group);
    } else if (!sameConnection(group.config, configParsed.data)) {
      // F4.326 security review M1, defence in depth: one endpoint key must mean
      // one connection. A row whose host, port or TLS choice differs from the
      // group's would ride a connection its own row never asked for.
      skipped.push({ rtuId, rtuCode: deviceKey, reason: "endpoint-config-conflict", detail: endpointKey });
      continue;
    }

    // ADR 0116 decision 4: one topic, one format. The adapter decodes a message
    // by the topic it arrived on, so a second RTU on the same topic naming a
    // different format is skipped by name; the first stays served. "First" is
    // the topic's owner when it has one (`byOwnTopicFirst` below), so another
    // tenant borrowing the topic through `config.device.topic` cannot knock the
    // owner out (F4.334 security review M1). Checked before the credential
    // merge, so a skipped RTU never supplies the endpoint's credentials (L1).
    if (protocol === "mqtt") {
      const topic = String(asRecord(deviceParsed.data).topic);
      const code = payloadFormat?.code ?? MQTT_BUILTIN_PAYLOAD_FORMAT_CODE;
      const existing = group.formatByTopic.get(topic);
      if (existing !== undefined && existing !== code) {
        skipped.push({ rtuId, rtuCode: deviceKey, reason: "payload-format-conflict", detail: topic });
        continue;
      }
      group.formatByTopic.set(topic, code);
    }

    if (group.bindings.length === 0) {
      // The group was created by this RTU, so its credentials are already this RTU's.
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

    indexPointRows(group.index, deviceKey, pointRows);
  }

  return {
    endpoints: [...endpoints.values()].map((group) => ({
      protocol: group.protocol,
      endpointKey: group.endpointKey,
      config: group.config,
      credentials: group.credentials,
      bindings: group.bindings,
      pointIndex: group.index,
      decoderFingerprint: decoderFingerprint(group.protocol, group.bindings),
    })),
    skipped,
    warnings,
    edgeServed,
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
