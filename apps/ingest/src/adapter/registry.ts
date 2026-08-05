import type { IngestProtocol } from "@bms/shared/ingest";

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
 * ADR 0011. It becomes metadata *seeded from* this map, never the runtime
 * source of truth.
 *
 * **This is the one file every F1.2–F1.6 agent touches.**
 * `docs/build-operating-model.md` §3 forbids two agents editing the same file;
 * this is the single deliberate exception, held to one line and one import
 * each. Keep the keys alphabetically ordered so a merge conflict stays
 * mechanically resolvable.
 *
 * `Partial<Record<…>>` because most protocols have no adapter yet;
 * `satisfies` because an unknown key must be a compile error rather than a
 * protocol nothing can serve.
 */
const ADAPTERS = {
  mqtt: mqttAdapterFactory,
  // F1.2 adds `modbus_tcp:`, F1.3 `bacnet:`, F1.4 `opc_ua:`, F1.5 `snmp:` and
  // `rest_poller:`, F1.6 its own. One line and one import each — nothing else
  // in this file changes.
} satisfies Partial<Record<IngestProtocol, IngestAdapterFactory>>;

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
