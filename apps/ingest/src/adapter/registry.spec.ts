import { expect } from "vitest";

import { INGEST_PROTOCOLS, INGEST_WIRED_PROTOCOLS, protocolCatalogEntry } from "@bms/shared/ingest";

import { lookupAdapter } from "./registry.js";

/**
 * `F3.24a` / ADR 0093 decision 2 — the adapter registry and the shared
 * protocol catalog agree.
 *
 * `registry.ts`'s `satisfies Record<IngestWiredProtocol, …>` is the
 * compile-time half; these are the runtime half. Assertions live here;
 * `registry.test.ts` is the vitest entry point (ADR 0014).
 */

const WIRED: readonly string[] = INGEST_WIRED_PROTOCOLS;

/** R1 — every wired protocol resolves to an adapter, and no other ingest protocol does. */
export function assertEveryWiredProtocolHasAnAdapterAndNoOtherDoes(): void {
  for (const protocol of INGEST_PROTOCOLS) {
    expect(lookupAdapter(protocol) !== undefined, protocol).toBe(WIRED.includes(protocol));
  }
}

/** R2 — the catalog's `supportsDiscovery` matches the factory it describes. */
export function assertTheCatalogAndTheFactoryAgreeOnDiscovery(): void {
  for (const protocol of INGEST_WIRED_PROTOCOLS) {
    expect(Boolean(lookupAdapter(protocol)?.supportsDiscovery), protocol).toBe(
      protocolCatalogEntry(protocol).supportsDiscovery,
    );
  }
}
