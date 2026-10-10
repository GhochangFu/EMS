/**
 * `F3.85` PR 4 — the `clientOnly` fields of each catalog entry: body keys the
 * user types on the Confirm card and the model never sees (ADR 0099 ruling on
 * temporary passwords). The interceptor strips them before it compares the
 * body hash.
 *
 * Empty in PR 4: the action catalog arrives in PR 8, which replaces this
 * lookup with the catalog's own. An unknown entry strips nothing, which is the
 * strict direction — the whole body must then match the stored hash.
 */
const CLIENT_ONLY: ReadonlyMap<string, readonly string[]> = new Map();

/** The body keys a catalog entry takes from the Confirm card rather than from the model; none for an unknown entry. */
export function clientOnlyKeysFor(catalogId: string): readonly string[] {
  return CLIENT_ONLY.get(catalogId) ?? [];
}
