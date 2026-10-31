import { expect } from "vitest";

import { partialCoverage } from "./energy-view-partial";

/**
 * `F4.298` U2 (ADR 0108 decision 2.9) — the "partial — your access covers N of
 * M sites" counts. Two counts and nothing else; `null` for a caller whose
 * `readableLocationIds` is `null` (a global admin). Vitest entry point: the
 * sibling `.test.ts`.
 */

export function assertAGlobalReaderHasNoPartial(): void {
  expect(partialCoverage(["a", "b", "c"], null)).toBeNull();
}

export function assertTheCountsAreTheReadablePartOfTheSelection(): void {
  expect(partialCoverage(["a", "b", "c"], ["a", "c", "z"])).toEqual({ readableSites: 2, selectedSites: 3 });
}

export function assertTheAnswerCarriesOnlyTheTwoCounts(): void {
  const partial = partialCoverage(["a", "b"], ["a"]);
  expect(Object.keys(partial ?? {}).sort()).toEqual(["readableSites", "selectedSites"]);
}

export function assertARepeatedSiteCountsOnce(): void {
  expect(partialCoverage(["a", "a", "b"], ["a"])).toEqual({ readableSites: 1, selectedSites: 2 });
}

export function assertAFullyReadableSelectionCountsEqual(): void {
  expect(partialCoverage(["a", "b"], ["a", "b", "c"])).toEqual({ readableSites: 2, selectedSites: 2 });
}
