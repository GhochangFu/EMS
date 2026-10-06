import { PROTOCOL_CATALOG } from "@bms/shared";

import { configCarriesCredential } from "./onboarding-agent-tools";
import { OnboardingProtocolService, type ProtocolContext } from "./onboarding-protocol.service";

/**
 * `F3.24a` / ADR 0093 decision 3 — the protocol service reads the code catalog.
 *
 * Assertions live here; `onboarding-protocol.service.test.ts` is the vitest
 * entry point (ADR 0014). One claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A database whose every property read throws, so any query reddens the case. */
const throwingDb = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`the catalog read the database (${String(property)})`);
    },
  },
);

function format(context: ProtocolContext): string {
  return OnboardingProtocolService.prototype.formatForAssistant.call(undefined, context, "RTU-1");
}

/** P1 — the catalog comes from code: eight entries, no database read (the old `try/catch` hid exactly this). */
export async function assertListCatalogReadsNoDatabase(): Promise<void> {
  const catalog = await new OnboardingProtocolService(throwingDb as never).listCatalog();
  assert(catalog.length === 8, `expected 8 entries, got ${catalog.length}`);
}

/** P2 — each line names the code, the wiring, the fields and discovery. */
export function assertFormatForAssistantNamesTheFieldsAndTheWiring(): void {
  const text = format({ catalog: PROTOCOL_CATALOG, orgExamples: [] });
  for (const expected of [
    "**MQTT** (`mqtt`, live ingest)",
    "Required: topic",
    "Optional: host, port",
    "Browse: no",
    "(`modbus_tcp`, config only)",
  ]) {
    assert(text.includes(expected), `missing ${JSON.stringify(expected)} in:\n${text}`);
  }
}

/** P3 — by the real credential predicate, no example config and no field name is a credential. */
export function assertNoCatalogKeyIsACredentialByTheRealPredicate(): void {
  for (const entry of PROTOCOL_CATALOG) {
    assert(!configCarriesCredential(entry.exampleConfig), `${entry.code} exampleConfig carries a credential`);
    const fields = Object.fromEntries([...entry.requiredFields, ...entry.optionalFields].map((k) => [k, "x"]));
    assert(!configCarriesCredential(fields), `${entry.code} field names carry a credential`);
  }
}

/** P4 — with no org examples the reply still ends with the unchanged examples line. */
export function assertFormatForAssistantKeepsTheOrgExamplesTail(): void {
  const text = format({ catalog: PROTOCOL_CATALOG, orgExamples: [] });
  const tail = "- No existing RTU protocol examples in this org yet. Try **RTU-1** with **MQTT**.";
  assert(text.endsWith(tail), `expected the reply to end with the examples line:\n${text}`);
}
