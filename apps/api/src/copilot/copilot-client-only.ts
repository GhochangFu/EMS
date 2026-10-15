import { hashExcludedKeysFor } from "@bms/shared/copilot";

/**
 * `F3.85` PRs 4 and 8 — the body keys the interceptor strips before it
 * compares the body hash: each catalog entry's `clientOnly` fields (typed on
 * the Confirm card, never seen by the model; ADR 0099 ruling on temporary
 * passwords) and, since `F3.87` PR 2, its `cardOnly` keys (stored for the card
 * alone, never sent).
 *
 * Read from the action catalog (`hashExcludedKeysFor`). An unknown entry
 * strips nothing, which is the strict direction — the whole body must then
 * match the stored hash.
 */
export function clientOnlyKeysFor(catalogId: string): readonly string[] {
  return hashExcludedKeysFor(catalogId);
}
