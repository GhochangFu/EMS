import { parseMqttPlaintextHosts } from "@bms/shared/ingest";

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
