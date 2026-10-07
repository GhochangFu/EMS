import { expect } from "vitest";

import { onboardingProtocolSchema } from "./contracts/onboarding";
import { mqttDraftConfigSchema } from "./ingest-adapters/mqtt";
// Entered at the module itself, not through `./ingest`: no runtime import cycle
// remains (`F3.24a` review), so the catalog builds in any entry order.
import { INGEST_WIRED_PROTOCOLS, PROTOCOL_CATALOG, describeProtocol, protocolCatalogEntry } from "./protocol-catalog";

/**
 * `F3.24a` / ADR 0093 decisions 2 and 3 — the code-defined protocol catalog.
 *
 * Assertions live here; `protocol-catalog.test.ts` is the vitest entry point
 * (ADR 0014). One claim per exported function, so a mutation reddens the `it`
 * that owns it.
 */

/**
 * A **copy** of the API's credential-key vocabulary, because `packages/shared`
 * cannot import `apps/api`. Two sources:
 * - `SECRET_FRAGMENTS`, `apps/api/src/admin/onboarding/onboarding-redaction.ts`
 *   (24 fragments, matched as substrings of the normalised key);
 * - `AGENT_SECRET_KEY_NAMES`, `apps/api/src/admin/onboarding/onboarding-agent-tools.ts`
 *   (exact normalised names), plus that file's `includes("auth")` rule.
 * `onboarding-protocol.service.spec.ts` runs the **real** predicate,
 * `configCarriesCredential`, over the same keys, so this copy cannot drift unnoticed.
 */
const COPIED_SECRET_FRAGMENTS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "token",
  "credential",
  "apikey",
  "authkey",
  "privkey",
  "privatekey",
  "sharedaccesskey",
  "accesskey",
  "clientkey",
  "cakey",
  "tlskey",
  "sslkey",
  "keypem",
  "signingkey",
  "encryptionkey",
  "community",
  "cert",
  "username",
  "login",
];
const COPIED_AGENT_SECRET_KEY_NAMES = new Set([
  "user",
  "username",
  "login",
  "pass",
  "pw",
  "creds",
  "cred",
  "psk",
  "pin",
  "bearer",
  "key",
]);

/** As `onboarding-redaction.ts` `normaliseKey`: lowercase, separators dropped. */
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Every key of a value, walked to any depth. */
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysDeep);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]);
  }
  return [];
}

/** C1 — one entry per onboarding protocol, no duplicate, MQTT first, in declaration order. */
export function assertOneEntryPerOnboardingProtocolInDeclarationOrder(): void {
  const codes = PROTOCOL_CATALOG.map((e) => e.code);
  expect(new Set(codes)).toEqual(new Set(onboardingProtocolSchema.options));
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes).toHaveLength(8);
  expect(codes[0]).toBe("mqtt");
  // Declaration order is display order (`protocol-catalog.ts`), so the whole order is pinned.
  expect(codes).toEqual(["mqtt", "simulator", "catalog", "modbus_tcp", "bacnet", "opc_ua", "snmp", "rest_poller"]);
}

/** C2 — `ingestWired` is derived from the wired list, and the list is MQTT alone today. */
export function assertIngestWiredIsDerivedFromTheWiredList(): void {
  for (const e of PROTOCOL_CATALOG) {
    expect(e.ingestWired, e.code).toBe((INGEST_WIRED_PROTOCOLS as readonly string[]).includes(e.code));
  }
  expect([...INGEST_WIRED_PROTOCOLS]).toEqual(["mqtt"]);
}

/** C3 — no protocol supports discovery until `F1.4` or `F1.5` flips one. */
export function assertSupportsDiscoveryIsFalseEverywhereToday(): void {
  for (const e of PROTOCOL_CATALOG) {
    expect(e.supportsDiscovery, e.code).toBe(false);
  }
}

/** C4 — no field name or example key is a credential key, by the copied vocabulary. */
export function assertNoCatalogKeyIsACredentialKey(): void {
  for (const e of PROTOCOL_CATALOG) {
    const keys = [...e.requiredFields, ...e.optionalFields, ...keysDeep(e.exampleConfig)];
    for (const key of keys) {
      const normalised = normaliseKey(key);
      const label = `${e.code}.${key}`;
      expect(
        COPIED_SECRET_FRAGMENTS.filter((f) => normalised.includes(f)),
        label,
      ).toEqual([]);
      expect(COPIED_AGENT_SECRET_KEY_NAMES.has(normalised), label).toBe(false);
      expect(normalised.includes("auth"), label).toBe(false);
    }
  }
}

/** C5 — MQTT carries the shared draft schema by identity; every other protocol accepts any config. */
export function assertTheMqttEntryCarriesTheDraftSchema(): void {
  expect(protocolCatalogEntry("mqtt").draftConfigSchema).toBe(mqttDraftConfigSchema);
  for (const e of PROTOCOL_CATALOG.filter((x) => x.code !== "mqtt")) {
    expect(e.draftConfigSchema.safeParse({ anything: 1 }).success, e.code).toBe(true);
  }
}

/** C6 — the view the model receives survives JSON and carries no schema object. */
export function assertDescribeProtocolIsJsonSafe(): void {
  for (const e of PROTOCOL_CATALOG) {
    const view = describeProtocol(e);
    expect(JSON.parse(JSON.stringify(view)), e.code).toEqual(view);
    expect(Object.keys(view), e.code).not.toContain("draftConfigSchema");
  }
}

/** C7 — MQTT needs a topic and may take host and port; no unwired protocol requires a field. */
export function assertRequiredFieldsAreRequiredByTheDraftSchemaOnlyWhereItSaysSo(): void {
  const mqtt = protocolCatalogEntry("mqtt");
  expect(mqtt.requiredFields).toEqual(["topic"]);
  expect(mqtt.optionalFields).toEqual(["host", "port"]);
  for (const e of PROTOCOL_CATALOG.filter((x) => !x.ingestWired)) {
    expect(e.requiredFields, e.code).toEqual([]);
  }
}
