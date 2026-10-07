import type { IngestProtocol, IngestWiredProtocol } from "@bms/shared/ingest";

import { mqttAdapterFactory } from "../adapters/mqtt.js";
import type { IngestAdapterFactory } from "./types.js";

/**
 * The adapter registry (ADR 0016 §3, Options C3).
 *
 * A static map, not a filesystem scan and not a database table. A scan makes a
 * typo'd filename into a protocol that is simply absent at runtime with no
 * compile error — the orphaned-artefact shape this repository has now shipped
 * three times. `bms.protocol_catalog` was the other candidate and was rejected
 * on evidence: it has no migration and no seed, and `listCatalog()` swallows
 * the missing relation, so the catalog has been silently reading empty since
 * ADR 0011. Since `F3.24a` (ADR 0093 decision 2) the catalog is code in
 * `@bms/shared/ingest`: `INGEST_WIRED_PROTOCOLS` declares which protocols have
 * an adapter, and this map is checked against that list at compile time.
 *
 * **This is the one file every F1.2–F1.6 agent touches.**
 * `docs/build-operating-model.md` §3 forbids two agents editing the same file;
 * this is the single deliberate exception, held to one line and one import
 * each. Keep the keys alphabetically ordered so a merge conflict stays
 * mechanically resolvable.
 *
 * `satisfies Record<IngestWiredProtocol, …>`: a wired protocol with no adapter
 * is a missing property, and an adapter the wired list lacks is an excess
 * property — either is a compile error, so the catalog's `ingestWired` cannot
 * disagree with what this map serves. An adapter PR adds its code to
 * `INGEST_WIRED_PROTOCOLS` and its line here together.
 */
const ADAPTERS = {
  mqtt: mqttAdapterFactory,
  // F1.2 adds `modbus_tcp:`, F1.3 `bacnet:`, F1.4 `opc_ua:`, F1.5 `snmp:` and
  // `rest_poller:`, F1.6 its own. One line and one import each — nothing else
  // in this file changes.
} satisfies Record<IngestWiredProtocol, IngestAdapterFactory>;

/** Protocols that actually have an adapter, as opposed to a name in the union. */
export const REGISTERED_PROTOCOLS = Object.keys(ADAPTERS) as readonly IngestProtocol[];

/**
 * Resolves a protocol to its factory, or `undefined` when nothing serves it.
 *
 * Returning `undefined` rather than throwing is deliberate: an RTU configured
 * for a protocol with no adapter is skipped and logged once, and the host keeps
 * running for every other endpoint (§3, §5).
 */
export function lookupAdapter(protocol: IngestProtocol): IngestAdapterFactory | undefined {
  return (ADAPTERS as Partial<Record<IngestProtocol, IngestAdapterFactory>>)[protocol];
}
