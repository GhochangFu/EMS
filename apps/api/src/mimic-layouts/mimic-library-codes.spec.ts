import { expect } from "vitest";

import { KNOWN_LIBRARY_CODES, splitLibraryCodes } from "./mimic-library-codes";

/**
 * `F3.32f` slice 1 — the read guard on a stored `symbol_libraries` array (ADR 0086
 * decision 10). Assertions live here; `mimic-library-codes.test.ts` is the Vitest entry
 * point (ADR 0014). Pure: no database.
 */

/** Every code the contract names is kept, in order, and nothing is dropped. */
export function keepsEveryKnownCode(): void {
  const stored = ["core", "tabler", "lucide", "mdi"];
  const { kept, dropped } = splitLibraryCodes(stored, KNOWN_LIBRARY_CODES);
  expect(kept).toEqual(stored);
  expect(dropped).toEqual([]);
}

/** A code the contract does not name is dropped, and the known one kept. */
export function dropsAnUnknownCode(): void {
  const { kept, dropped } = splitLibraryCodes(["core", "bogus"], KNOWN_LIBRARY_CODES);
  expect(kept).toEqual(["core"]);
  expect(dropped).toEqual(["bogus"]);
}

/** The order and the duplicates of the stored array are kept as they are. */
export function preservesOrderAndDuplicates(): void {
  const { kept, dropped } = splitLibraryCodes(["mdi", "core", "mdi"], KNOWN_LIBRARY_CODES);
  expect(kept).toEqual(["mdi", "core", "mdi"]);
  expect(dropped).toEqual([]);
}

/** An empty array answers two empty arrays. */
export function answersEmptyForEmpty(): void {
  const { kept, dropped } = splitLibraryCodes([], KNOWN_LIBRARY_CODES);
  expect(kept).toEqual([]);
  expect(dropped).toEqual([]);
}

/** The `known` parameter decides, not the contract: a set without `core` drops `core`. */
export function readsTheKnownParameter(): void {
  const { kept, dropped } = splitLibraryCodes(["core", "mdi"], new Set(["mdi"]));
  expect(kept).toEqual(["mdi"]);
  expect(dropped).toEqual(["core"]);
}
