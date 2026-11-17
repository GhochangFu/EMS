import { expect } from "vitest";

import { ADVISORY_CONFIDENCES, ADVISORY_KINDS } from "@bms/shared/contracts";

import {
  ADVISORIES_REFETCH_MS,
  advisoryConfidenceLabel,
  advisoryKindLabel,
  shownOfSentence,
} from "./advisories";

/**
 * `E1.6b` / ADR 0137 (plan T2.1) — the pure helpers of the advisories page and card.
 * Entry point: `advisories.test.ts` (ADR 0014).
 */

/** Every kind has its fixed label. */
export function eachKindHasItsLabel(): void {
  expect(ADVISORY_KINDS.map(advisoryKindLabel)).toEqual([
    "Low power factor",
    "Consumption above baseline",
    "Forecast demand near contract",
  ]);
}

/** Every confidence has its fixed label. */
export function eachConfidenceHasItsLabel(): void {
  expect(ADVISORY_CONFIDENCES.map(advisoryConfidenceLabel)).toEqual(["Measured", "Estimated", "Forecast-based"]);
}

/** The page reads again every 15 minutes. */
export function theRefetchIsFifteenMinutes(): void {
  expect(ADVISORIES_REFETCH_MS).toBe(900_000);
}

/** A capped answer says how many meters were considered of how many; a whole one says nothing. */
export function theShownOfSentenceOnlyWhenCapped(): void {
  expect(shownOfSentence(200, 412)).toBe("Showing 200 of 412 meters.");
  expect(shownOfSentence(200, 200)).toBeNull();
  expect(shownOfSentence(3, 3)).toBeNull();
  expect(shownOfSentence(0, 0)).toBeNull();
}
