import type { EnergyViewPartial } from "@bms/shared";

/**
 * `F4.298` U2 (ADR 0108 decision 2.9) — the "partial — your access covers N of
 * M sites" counts, pure.
 *
 * `selected` is the subtree of the named locations, or every active location
 * of the organization when none is named; `readable` is the caller's
 * `readableLocationIds` (`null` for a global reader, who gets no partial).
 * The answer carries two counts only, never an id (owner ruling: the counts
 * tell a scoped user the size of the organization, and that is accepted).
 */
export function partialCoverage(
  selected: readonly string[],
  readable: readonly string[] | null,
): EnergyViewPartial | null {
  if (readable === null) {
    return null;
  }
  const readableSet = new Set(readable);
  const selectedSet = new Set(selected);
  let readableSites = 0;
  for (const id of selectedSet) {
    if (readableSet.has(id)) {
      readableSites += 1;
    }
  }
  return { readableSites, selectedSites: selectedSet.size };
}
