import { expect } from "vitest";

import { ORGANIZATION_RANK, parameterValueAt, type ParameterSeriesRow } from "./calc-parameter-series";

/**
 * `F4.311` task 5.4 — `parameterValueAt`, pure. The series below is the
 * `E4.1a` fixture's shape in milliseconds: an asset row `[100, 200)`, a
 * location row `[0, 200)` and an organization row `[0, ∞)`, sorted by rank
 * as the read returns them.
 */
const SERIES: readonly ParameterSeriesRow[] = [
  { fromMs: 100, toMs: 200, value: 3, rank: 0 },
  { fromMs: 0, toMs: 200, value: 2, rank: 1 },
  { fromMs: 0, toMs: null, value: 1, rank: ORGANIZATION_RANK },
];

/** Inside the asset row's window, the asset row wins. */
export function theNearestScopeWinsInsideItsWindow(): void {
  expect(parameterValueAt(SERIES, 150)).toBe(3);
}

/** Before the asset row starts, the location row is in force. */
export function theNextScopeServesBeforeTheNearestStarts(): void {
  expect(parameterValueAt(SERIES, 50)).toBe(2);
}

/** At exactly `toMs` a row has ended (half-open), so the organization row serves. */
export function aRowHasEndedAtItsOwnEnd(): void {
  expect(parameterValueAt(SERIES, 200)).toBe(1);
}

/** At exactly `fromMs` a row has begun. */
export function aRowHasBegunAtItsOwnStart(): void {
  expect(parameterValueAt(SERIES, 100)).toBe(3);
}

/** No row holds the instant → `undefined`, never a default. */
export function anUncoveredInstantIsUndefined(): void {
  expect(parameterValueAt(SERIES, -1)).toBeUndefined();
}
