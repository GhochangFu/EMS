import { parseMqttPlaintextHosts } from "@bms/shared/ingest";

import type { IngestAdapterFactory } from "../adapter/types.js";
import { mqttAdapterFactory } from "../adapters/mqtt.js";

import { planEndpoints, type PlanResult } from "./bindings.js";
import { ENV_CONNECTION, makeOptions, row } from "./bindings.spec.js";

/**
 * `F4.326` / ADR 0114 decision 3 — the ingest host's plain-MQTT check.
 *
 * The host, not the adapter, applies the rule, because an adapter may not read
 * the environment (ADR 0016 §4). An RTU with `tls: false` connects plain only
 * when the host **the connection uses** (`resolved.host`, which may come from
 * `MQTT_HOST`) is on `MQTT_PLAINTEXT_HOSTS`; otherwise it is skipped as
 * `plaintext-host-not-allowed` and never connected with TLS instead.
 *
 * Fixtures are `bindings.spec.ts`'s, shared rather than copied.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const PLAIN_PORT = 1883;

function reasons(result: PlanResult): string[] {
  return result.skipped.map((s) => s.reason);
}

/** B1 — an unlisted `tls: false` RTU is skipped by name, with no endpoint. */
export function runUnlistedPlainIsSkippedTests(): void {
  for (const mqttPlaintextHosts of [undefined, parseMqttPlaintextHosts("other.example")]) {
    const result = planEndpoints(
      [row({ connection_config: { tls: false, port: PLAIN_PORT } })],
      makeOptions(mqttPlaintextHosts === undefined ? {} : { mqttPlaintextHosts }),
    );
    assert(result.endpoints.length === 0, "an unlisted plain RTU must not be served at all");
    assert(
      JSON.stringify(reasons(result)) === JSON.stringify(["plaintext-host-not-allowed"]),
      `the refusal must be named: ${JSON.stringify(result.skipped)}`,
    );
  }
}

/** B2 — a listed `tls: false` RTU is one endpoint whose config keeps `tls: false`. */
export function runListedPlainIsServedTests(): void {
  const result = planEndpoints(
    [row({ connection_config: { host: "plain.example", port: PLAIN_PORT, tls: false } })],
    makeOptions({
      mqttPlaintextHosts: parseMqttPlaintextHosts("Plain.Example"),
      resolveMqttConnection: () => ({
        host: "plain.example",
        port: PLAIN_PORT,
        credentialSource: "env",
      }),
    }),
  );
  assert(result.skipped.length === 0, `nothing skipped: ${JSON.stringify(result.skipped)}`);
  assert(result.endpoints.length === 1, "one endpoint");
  const config = result.endpoints[0].config as { tls: boolean };
  assert(config.tls === false, "the plain choice reaches the adapter's config");
  assert(
    result.endpoints[0].endpointKey === `mqtt://plain.example:${PLAIN_PORT}`,
    `a plain endpoint is keyed with its scheme, got ${result.endpoints[0].endpointKey}`,
  );
}

/** B3 — `tls: true` (or absent) on an unlisted host is an ordinary TLS endpoint. */
export function runTlsRtuIsUnaffectedTests(): void {
  for (const connection_config of [{ tls: true }, null]) {
    const result = planEndpoints([row({ connection_config })], makeOptions());
    assert(result.endpoints.length === 1, `a TLS RTU is served: ${JSON.stringify(result.skipped)}`);
    assert((result.endpoints[0].config as { tls: boolean }).tls === true, "TLS stays on");
    assert(
      result.endpoints[0].endpointKey === `${ENV_CONNECTION.host}:${ENV_CONNECTION.port}`,
      "the TLS endpoint key is unchanged (plan R1)",
    );
  }
}

/**
 * B4 — the check reads the host the connection uses, not the stored one.
 *
 * With no stored host the env fallback supplies it: listed → served. A stored
 * host that is listed while the resolver hands back another one is refused.
 * Reddens if the check reads `connection.host`.
 */
export function runTheCheckReadsTheResolvedHostTests(): void {
  const fallback = planEndpoints(
    [row({ connection_config: { tls: false } })],
    makeOptions({ mqttPlaintextHosts: parseMqttPlaintextHosts(ENV_CONNECTION.host) }),
  );
  assert(
    fallback.endpoints.length === 1,
    `an env-fallback host on the list is served: ${JSON.stringify(fallback.skipped)}`,
  );

  const mismatch = planEndpoints(
    [row({ connection_config: { host: "listed.example", tls: false } })],
    makeOptions({ mqttPlaintextHosts: parseMqttPlaintextHosts("listed.example") }),
  );
  assert(mismatch.endpoints.length === 0, "the stored host does not vouch for the resolved one");
  assert(
    reasons(mismatch).includes("plaintext-host-not-allowed"),
    `named: ${JSON.stringify(mismatch.skipped)}`,
  );
}

/** B5 — the string `"false"` is not plain: it fails the schema, it never connects. */
export function runStringFalseIsInvalidTests(): void {
  const result = planEndpoints(
    [row({ connection_config: { tls: "false" } })],
    makeOptions({ mqttPlaintextHosts: parseMqttPlaintextHosts(ENV_CONNECTION.host) }),
  );
  assert(result.endpoints.length === 0, "a string tls is not served");
  assert(
    reasons(result).includes("invalid-connection-config"),
    `named: ${JSON.stringify(result.skipped)}`,
  );
}

const BLOB = { credentials_ciphertext: Buffer.from("c"), credentials_iv: Buffer.from("i"), key_version: 1 };
const ENV_CREDS = { username: "env-user", password: "env-secret" };

function plainResolver(host: string) {
  return () => ({ host, port: PLAIN_PORT, ...ENV_CREDS, credentialSource: "env" as const });
}

/**
 * B6 (security review M2) — a plain RTU with its own stored host sends only the
 * credentials from its own blob, never the environment's `MQTT_USERNAME` /
 * `MQTT_PASSWORD`, which belong to the pilot broker and would otherwise cross
 * the network in clear text to another one. The env fallback host keeps them.
 */
export function runPlainNeverSendsEnvCredentialsTests(): void {
  const hosts = parseMqttPlaintextHosts("plain.example");
  const noBlob = planEndpoints(
    [row({ connection_config: { host: "plain.example", port: PLAIN_PORT, tls: false } })],
    makeOptions({ mqttPlaintextHosts: hosts, resolveMqttConnection: plainResolver("plain.example") }),
  );
  assert(noBlob.endpoints.length === 1, `served: ${JSON.stringify(noBlob.skipped)}`);
  assert(
    JSON.stringify(noBlob.endpoints[0].credentials) === "{}",
    `no env credential on plain: ${Object.keys(noBlob.endpoints[0].credentials).join(",")}`,
  );

  const partial = planEndpoints(
    [row({ ...BLOB, connection_config: { host: "plain.example", port: PLAIN_PORT, tls: false } })],
    makeOptions({
      mqttPlaintextHosts: hosts,
      resolveMqttConnection: plainResolver("plain.example"),
      decryptCredentials: () => ({ username: "db-user" }),
    }),
  );
  assert(
    JSON.stringify(partial.endpoints[0].credentials) === JSON.stringify({ username: "db-user" }),
    "a blob with a username only never borrows the env password",
  );

  const full = planEndpoints(
    [row({ ...BLOB, connection_config: { host: "plain.example", port: PLAIN_PORT, tls: false } })],
    makeOptions({ mqttPlaintextHosts: hosts, resolveMqttConnection: plainResolver("plain.example") }),
  );
  assert(
    JSON.stringify(full.endpoints[0].credentials) === JSON.stringify({ username: "db-user", password: "db-secret" }),
    "the blob's own credentials are used",
  );

  const fallback = planEndpoints(
    [row({ connection_config: { tls: false } })],
    makeOptions({ mqttPlaintextHosts: parseMqttPlaintextHosts(ENV_CONNECTION.host) }),
  );
  assert(
    fallback.endpoints[0]?.credentials.password === "env-secret",
    "the MQTT_HOST fallback broker keeps its own env credentials",
  );
}

/**
 * B7 (security review M1) — a TLS RTU whose stored host is shaped like
 * `mqtt://<host>` cannot join a plain endpoint by colliding with its
 * `mqtt://host:port` key, in either row order.
 */
export function runTlsRtuCannotJoinAPlainEndpointTests(): void {
  const hosts = parseMqttPlaintextHosts("plain.example");
  const plain = row({
    rtu_id: "rtu-a",
    rtu_code: "RTU-A",
    connection_config: { host: "plain.example", port: PLAIN_PORT, tls: false },
  });
  const crafted = row({
    rtu_id: "rtu-b",
    rtu_code: "RTU-B",
    mqtt_topic: "t/b",
    ...BLOB,
    connection_config: { host: "mqtt://plain.example", port: PLAIN_PORT },
  });
  const resolve: PlanOptionsResolver = (configRow) => {
    const cfg = (configRow?.config ?? {}) as { host?: string };
    return { host: cfg.host ?? ENV_CONNECTION.host, port: PLAIN_PORT, credentialSource: "env" };
  };
  for (const rows of [
    [plain, crafted],
    [crafted, plain],
  ]) {
    const result = planEndpoints(rows, makeOptions({ mqttPlaintextHosts: hosts, resolveMqttConnection: resolve }));
    const served = result.endpoints.flatMap((e) => e.bindings.map((b) => b.rtuCode));
    assert(
      JSON.stringify(served) === JSON.stringify(["RTU-A"]),
      `only the plain RTU is served, got ${JSON.stringify(served)} ${JSON.stringify(result.skipped)}`,
    );
    assert((result.endpoints[0].config as { tls: boolean }).tls === false, "the plain endpoint stays plain");
    assert(JSON.stringify(result.endpoints[0].credentials) === "{}", "the crafted RTU's credentials never join");
    assert(
      result.skipped.some((s) => s.rtuCode === "RTU-B" && s.reason === "invalid-connection-config"),
      `the crafted RTU is named: ${JSON.stringify(result.skipped)}`,
    );
  }
}

type PlanOptionsResolver = NonNullable<Parameters<typeof makeOptions>[0]>["resolveMqttConnection"] & {};

/**
 * B8 (security review L1) — the decision reads the config the adapter will
 * use (after the environment defaults are merged under the row), not the raw
 * row: a `tls: false` arriving through the defaults is still checked.
 */
export function runTheCheckReadsTheMergedConfigTests(): void {
  const result = planEndpoints(
    [row()],
    makeOptions({ mqttConnectionDefaults: { rejectUnauthorized: true, tls: false } }),
  );
  assert(result.endpoints.length === 0, "a merged tls:false on an unlisted host is not served");
  assert(reasons(result).includes("plaintext-host-not-allowed"), `named: ${JSON.stringify(result.skipped)}`);
}

/** B9 — defence in depth for M1: rows on one endpoint key must agree on host, port and TLS. */
export function runOneKeyMeansOneConnectionTests(): void {
  const collidingFactory = {
    ...(mqttAdapterFactory as unknown as IngestAdapterFactory),
    endpointKey: () => "same-key",
  } as IngestAdapterFactory;
  const result = planEndpoints(
    [
      row({ rtu_id: "rtu-a", rtu_code: "RTU-A", connection_config: { tls: false } }),
      row({ rtu_id: "rtu-b", rtu_code: "RTU-B", mqtt_topic: "t/b", connection_config: { tls: true } }),
    ],
    makeOptions({
      lookup: () => collidingFactory,
      mqttPlaintextHosts: parseMqttPlaintextHosts(ENV_CONNECTION.host),
    }),
  );
  const served = result.endpoints.flatMap((e) => e.bindings.map((b) => b.rtuCode));
  assert(JSON.stringify(served) === JSON.stringify(["RTU-A"]), `one connection: ${JSON.stringify(served)}`);
  assert(
    result.skipped.some((s) => s.rtuCode === "RTU-B" && s.reason === "endpoint-config-conflict"),
    `named: ${JSON.stringify(result.skipped)}`,
  );
}
