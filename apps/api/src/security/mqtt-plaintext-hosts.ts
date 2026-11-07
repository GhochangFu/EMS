import type { FactoryProvider } from "@nestjs/common";

import { parseMqttPlaintextHosts } from "@bms/shared";

/**
 * `F4.326` / ADR 0114 decision 1 — `MQTT_PLAINTEXT_HOSTS` for the API and the
 * worker: the broker hosts an MQTT RTU with `tls: false` may reach without TLS.
 *
 * **The only file in `apps/api/src` that reads the variable**
 * (`tests/adr-0114-plaintext-hosts-invariants.test.ts`). The parser is
 * `@bms/shared`'s, the same one `apps/ingest` uses, so the three processes
 * cannot disagree on what a list means.
 *
 * The factory **throws** on a bad entry (plan ruling 10): Nest bootstrap fails
 * and the process refuses to start, with a message naming the entry's position
 * only. Registered in `AdminModule` (the validator and the start route) and in
 * `OnboardingDiscoveryModule` (the worker's job). Consumers inject it
 * `@Optional()`, so a bare construction has the empty set — fail closed.
 */
export const MQTT_PLAINTEXT_ALLOWLIST = Symbol("MQTT_PLAINTEXT_ALLOWLIST");

/** Pure over its input, so the spec needs no `process.env` mutation. */
export function readMqttPlaintextAllowlist(env: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
  return parseMqttPlaintextHosts(env.MQTT_PLAINTEXT_HOSTS);
}

export const mqttPlaintextAllowlistProvider: FactoryProvider<ReadonlySet<string>> = {
  provide: MQTT_PLAINTEXT_ALLOWLIST,
  useFactory: () => readMqttPlaintextAllowlist(process.env),
};
