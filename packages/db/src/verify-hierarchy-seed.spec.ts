import { expect } from "vitest";

import { failingChecks, type HierarchyCheck } from "./verify-hierarchy-seed";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.169`/`F4.170` addendum — `failingChecks` is the one place the boot gate
 * decides pass or fail. The `read*Checks` passes only read numbers, so an
 * integration test can run them inside its own rolled-back transaction; the
 * verdict is this pure function, and a check that stops failing closed here
 * lets every boot through.
 */

function check(kind: HierarchyCheck["kind"], actual: number, wanted: number): HierarchyCheck {
  return { label: `F4169 ${kind} probe`, actual, wanted, kind };
}

/** An exact mismatch fails with a message carrying the label and both numbers. */
export function assertAnExactMismatchNamesLabelAndBothNumbers(): void {
  expect(failingChecks([check("exact", 12, 11)])).toEqual(["F4169 exact probe: expected 11, got 12"]);
}

/** An exact match gives no failure. */
export function assertAnExactMatchGivesNothing(): void {
  expect(failingChecks([check("exact", 11, 11)])).toEqual([]);
}

/** A floor passes at the floor and above it. */
export function assertAFloorPassesAtTheFloor(): void {
  expect(failingChecks([check("atLeast", 1, 1), check("atLeast", 2, 1)])).toEqual([]);
}

/** A floor fails one below, with the "at least" message shape. */
export function assertAFloorFailsOneBelow(): void {
  expect(failingChecks([check("atLeast", 0, 1)])).toEqual(["F4169 atLeast probe: expected at least 1, got 0"]);
}

/**
 * `NaN` — a missing row — fails an exact check, and names the missing row.
 *
 * Mutation: an exact comparison written `actual === wanted ? … : …` with the
 * branches swapped, or `Number(x) == wanted` on a coerced value.
 */
export function assertNaNFailsAnExactCheck(): void {
  expect(failingChecks([check("exact", Number.NaN, 0)])).toEqual(["F4169 exact probe: expected 0, got no row"]);
}

/**
 * `NaN` fails a floor too.
 *
 * Mutation: the floor written `actual < wanted`, which is false for `NaN`, so
 * a missing row passes.
 */
export function assertNaNFailsAFloor(): void {
  expect(failingChecks([check("atLeast", Number.NaN, 1)])).toEqual([
    "F4169 atLeast probe: expected at least 1, got no row",
  ]);
}

/** Several failures keep their input order, one message each. */
export function assertFailuresKeepInputOrder(): void {
  const failures = failingChecks([
    { label: "first", actual: 1, wanted: 2, kind: "exact" },
    { label: "passes", actual: 3, wanted: 3, kind: "exact" },
    { label: "second", actual: 0, wanted: 1, kind: "atLeast" },
  ]);
  expect(failures).toEqual(["first: expected 2, got 1", "second: expected at least 1, got 0"]);
}
