import { MAX_DATASET_ROWS } from "@bms/shared";

import {
  MEASURED_ROLLUP_FRESH_MS,
  capRows,
  freshnessBoundSeconds,
  rollup,
  rollupCurrency,
} from "./sustainability-rollup";

/**
 * `E4.2` U4 — the pure half of the sustainability roll-up (ADR 0072 decision 2 and rulings 1,
 * 4). Assertions live here; `sustainability-rollup.test.ts` is the Vitest entry point (ADR
 * 0014). One exported function per claim.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const same = (actual: unknown, expected: unknown, what: string): void => {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

/** Zero carrying assets: the catalog's existing null, with `0/0` coverage. */
export function rollupOfNothingIsNullWithZeroCoverage(): void {
  same(rollup([], "sum"), { value: null, coverage: { fresh: 0, carrying: 0 } }, "rollup([], sum)");
}

/** `avg` over the FRESH values only; the stale one counts in `carrying`, not in the mean. */
export function avgSkipsTheStaleRowButCountsIt(): void {
  same(
    rollup([{ value: 10 }, { value: 20 }, { value: null }], "avg"),
    { value: 15, coverage: { fresh: 2, carrying: 3 } },
    "avg of [10, 20, null]",
  );
}

/** `sum` over the fresh values; a fresh zero is a value, not an absence. */
export function sumCountsAFreshZero(): void {
  same(
    rollup([{ value: 0 }, { value: 7 }, { value: null }], "sum"),
    { value: 7, coverage: { fresh: 2, carrying: 3 } },
    "sum of [0, 7, null]",
  );
}

/** All carrying assets stale: null value, never a fabricated zero (no `?? 0`). */
export function allStaleIsNullNotZero(): void {
  same(
    rollup([{ value: null }, { value: null }], "sum"),
    { value: null, coverage: { fresh: 0, carrying: 2 } },
    "sum of [null, null]",
  );
}

/** One currency is the currency. */
export function oneCurrencyIsTheCurrency(): void {
  same(rollupCurrency(new Set(["INR"])), "INR", "rollupCurrency({INR})");
}

/** Two currencies are not a number. */
export function twoCurrenciesAreNull(): void {
  same(rollupCurrency(new Set(["INR", "ZAR"])), null, "rollupCurrency({INR, ZAR})");
}

/** A row with no currency beside one with a currency is `null` — a null is its own "currency". */
export function aNullBesideACurrencyIsNull(): void {
  same(rollupCurrency(new Set(["INR", null])), null, "rollupCurrency({INR, null})");
}

/** A scheduled derived point at 60 s is fresh for 180 s (3 × interval). */
export function scheduledDerivedBoundIsThreeIntervals(): void {
  same(
    freshnessBoundSeconds({ kind: "derived", calcTrigger: "scheduled", calcIntervalSeconds: 60 }),
    180,
    "derived scheduled 60 s",
  );
}

/** A measured point has no interval: the flat 15-minute constant, in seconds. */
export function measuredBoundIsTheConstant(): void {
  same(MEASURED_ROLLUP_FRESH_MS, 15 * 60 * 1000, "MEASURED_ROLLUP_FRESH_MS");
  same(
    freshnessBoundSeconds({ kind: "measured", calcTrigger: null, calcIntervalSeconds: null }),
    900,
    "measured",
  );
}

/** A derived point with no interval (on-change, or a null interval) falls back to the constant too. */
export function derivedWithoutIntervalUsesTheConstant(): void {
  same(
    freshnessBoundSeconds({ kind: "derived", calcTrigger: "on_change", calcIntervalSeconds: null }),
    900,
    "derived without a scheduled interval",
  );
}

/** `capRows` at `MAX_DATASET_ROWS + 1` rows: the cap's worth and `truncated: true`. */
export function capRowsFlagsThe201stRow(): void {
  const rows = Array.from({ length: MAX_DATASET_ROWS + 1 }, (_, i) => ({ i }));
  const capped = capRows(rows);
  same(
    { length: capped.rows.length, truncated: capped.truncated },
    { length: MAX_DATASET_ROWS, truncated: true },
    "capRows over the cap",
  );
}

/** Exactly `MAX_DATASET_ROWS` rows is not truncated — the flag is a fact, not a guess. */
export function capRowsAtTheCapIsNotTruncated(): void {
  const rows = Array.from({ length: MAX_DATASET_ROWS }, (_, i) => ({ i }));
  const capped = capRows(rows);
  same(
    { length: capped.rows.length, truncated: capped.truncated },
    { length: MAX_DATASET_ROWS, truncated: false },
    "capRows at the cap",
  );
}
