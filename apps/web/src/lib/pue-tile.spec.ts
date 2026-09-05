import { expect } from "vitest";

import { pueTileProps } from "./pue-tile";

/**
 * `F2.8` — the three PUE tiles, from one function.
 *
 * Assertions live here; `pue-tile.test.ts` is the Vitest entry point (ADR 0014).
 *
 * The function this file covers replaced `pue-estimate.ts`, which held a copy of
 * the API's fitted PUE curve so the dashboard could show a number the API had
 * not sent. Ruling 4 of `F2.8` deletes the curve everywhere
 * and makes `pueEstimate` nullable, so the only thing left to share between the
 * three pages is **how a null is rendered** — and that is a decision, not a
 * formula: an unconfigured estate is not an error and not a zero.
 */

const READY_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";
const EMPTY_HINT = "Not configured — no incomer in scope computes site_kw and it_kw";

/** A measured ratio renders to two decimals, with the hint that says where it comes from. */
export function aMeasuredRatioRendersToTwoDecimals(): void {
  expect(pueTileProps("ready", 1.42)).toEqual({
    status: "ready",
    value: "1.42",
    hint: READY_HINT,
  });
  // Two decimals is the format, not a property of the sample: the API rounds to
  // 2 dp, and a value that arrives whole must not render as `2`.
  expect(pueTileProps("ready", 2).value).toBe("2.00");
}

/**
 * A ready query that returned `null` is **empty**, not `ready` with no value and
 * not an error.
 *
 * This is the assertion the row exists for. `KpiTile` renders `—` for
 * `status === "empty"` and renders `value` for `status === "ready"`, so passing
 * the query's own status straight through would print an empty tile with no dash
 * and no explanation. The hint names the two point keys an operator has to
 * configure, because "—" alone is indistinguishable from a broken page.
 */
export function anUnconfiguredEstateIsEmptyWithAReason(): void {
  expect(pueTileProps("ready", null)).toEqual({
    status: "empty",
    value: null,
    hint: EMPTY_HINT,
  });
  // `undefined` is the same fact arriving by a different route — the query has
  // settled but the caller reads `data?.pueEstimate` off an absent object.
  expect(pueTileProps("ready", undefined)).toEqual({
    status: "empty",
    value: null,
    hint: EMPTY_HINT,
  });
}

/**
 * Loading and error pass through, and they keep the *ready* hint.
 *
 * A query that has not settled has not established that nothing is configured,
 * so promising "not configured" while the request is still in flight would be a
 * claim the caller cannot make yet.
 */
export function aPendingOrFailedQueryPassesItsStatusThrough(): void {
  expect(pueTileProps("loading", undefined)).toEqual({
    status: "loading",
    value: null,
    hint: READY_HINT,
  });
  expect(pueTileProps("error", undefined)).toEqual({
    status: "error",
    value: null,
    hint: READY_HINT,
  });
  // Not "empty", even though the value is null — the status wins.
  expect(pueTileProps("error", null).status).toBe("error");
  // And a value that arrived before the query failed is still not rendered.
  expect(pueTileProps("error", 1.42).value).toBeNull();
  expect(pueTileProps("loading", 1.42).value).toBeNull();
}

/** The dash the empty tile renders is U+2014, and the hint carries the same glyph. */
export function theNotConfiguredHintCarriesTheEmDash(): void {
  // The pair is what pins the character. `toContain("—")` alone would pass on a
  // hint that also carried a hyphen; the negative case is what fails if the em
  // dash is ever typed as U+002D, which in the CSV export is an ADR 0026 formula
  // leader and arrives apostrophe-guarded.
  expect(pueTileProps("ready", null).hint).toContain("—");
  expect(pueTileProps("ready", null).hint).not.toContain("-");
}
