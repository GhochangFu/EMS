import { expect } from "vitest";

import { countBacktestFirings, type MinuteBucket } from "./rule-backtest";

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9) — the 7-day backtest's pure core. Each
 * series is one value per minute from a fixed instant; a value is a bucket's
 * mean, min and max at once, written as `sumValue` with `sampleCount: 1` unless
 * the case is about which of the three is compared (owner ruling 2026-10-24,
 * `F4.278` Q1: the max for `gt`/`gte`, the min for `lt`/`lte`, the mean for
 * `eq`). The hold is 120 s unless stated.
 */

const T0 = Date.UTC(2026, 9, 20, 0, 0, 0);
const MINUTE = 60_000;

/** A bucket at minute `minute` whose mean, min and max are all `value`. */
function at(minute: number, value: number, sampleCount = 1): MinuteBucket {
  return { bucket: new Date(T0 + minute * MINUTE), sumValue: value * sampleCount, sampleCount, minValue: value, maxValue: value };
}

/** One bucket at `T0` with a mean of 2.5 (10 over 4 samples), a min of 1 and a max of 6. */
const SPREAD: MinuteBucket = { bucket: new Date(T0), sumValue: 10, sampleCount: 4, minValue: 1, maxValue: 6 };

/** One value per consecutive minute. */
function series(values: readonly number[]): MinuteBucket[] {
  return values.map((value, minute) => at(minute, value));
}

/** One excursion over three buckets counts one firing. */
export function oneExcursionCountsOnce(): void {
  expect(countBacktestFirings(series([1, 5, 5, 5, 1, 1, 1]), "gt", 3, 120)).toBe(1);
}

/** Two excursions separated by at least the hold of normal values count twice. */
export function twoExcursionsApartByTheHoldCountTwice(): void {
  // Normal at minutes 2, 3, 4: 4 − 2 = 120 s ≥ the hold, so the state clears before minute 5.
  expect(countBacktestFirings(series([1, 5, 1, 1, 1, 5, 1]), "gt", 3, 120)).toBe(2);
}

/** Two excursions separated by less than the hold count once: the hold keeps the first firing open. */
export function twoExcursionsInsideTheHoldCountOnce(): void {
  // Normal at minutes 2 and 3 only: 3 − 2 = 60 s < the hold.
  expect(countBacktestFirings(series([1, 5, 1, 1, 5, 1]), "gt", 3, 120)).toBe(1);
}

/** An empty series counts nothing. */
export function anEmptySeriesCountsZero(): void {
  expect(countBacktestFirings([], "gt", 3, 120)).toBe(0);
}

/** A gap in the buckets advances time by the timestamps: a long gap of normal clears the state. */
export function aTimestampGapClearsByElapsedTime(): void {
  const buckets = [at(0, 5), at(1, 1), at(10, 1), at(11, 5)];
  expect(countBacktestFirings(buckets, "gt", 3, 120)).toBe(2);
}

/** The `lt` direction counts a dip below the threshold. */
export function theLtDirectionCountsADip(): void {
  expect(countBacktestFirings(series([5, 1, 5, 5, 5, 5]), "lt", 3, 120)).toBe(1);
}

/** A first bucket that already matches counts one firing. */
export function aFirstBucketThatMatchesCounts(): void {
  expect(countBacktestFirings(series([5, 5, 1]), "gt", 3, 120)).toBe(1);
}

/** `gt` compares the bucket max: a mean of 2.5 under the threshold 3, with a max of 6 over it, fires. */
export function aGtBucketWhoseMaxIsOverTheThresholdCounts(): void {
  expect(countBacktestFirings([SPREAD], "gt", 3, 120)).toBe(1);
}

/** `gte` compares the bucket max too: a max equal to the threshold fires though the mean is under it. */
export function aGteBucketWhoseMaxReachesTheThresholdCounts(): void {
  expect(countBacktestFirings([SPREAD], "gte", 6, 120)).toBe(1);
}

/** `lt` compares the bucket min: a mean of 2.5 over the threshold 2, with a min of 1 under it, fires. */
export function anLtBucketWhoseMinIsUnderTheThresholdCounts(): void {
  expect(countBacktestFirings([SPREAD], "lt", 2, 120)).toBe(1);
}

/** `lte` compares the bucket min too: a min equal to the threshold fires though the mean is over it. */
export function anLteBucketWhoseMinReachesTheThresholdCounts(): void {
  expect(countBacktestFirings([SPREAD], "lte", 1, 120)).toBe(1);
}

/** `eq` still compares the mean: 2.5 equals the threshold, and neither the min (1) nor the max (6) does. */
export function anEqBucketComparesTheMean(): void {
  expect(countBacktestFirings([SPREAD], "eq", 2.5, 120)).toBe(1);
}

/** A `gt` bucket with no max is skipped, never read as a mean (fails closed). */
export function aGtBucketWithNoMaxIsSkipped(): void {
  expect(countBacktestFirings([{ ...SPREAD, sumValue: 40, maxValue: null }], "gt", 3, 120)).toBe(0);
}

/** An `lt` bucket with no min is skipped, never read as a mean (fails closed). */
export function anLtBucketWithNoMinIsSkipped(): void {
  expect(countBacktestFirings([{ ...SPREAD, sumValue: 0, minValue: null }], "lt", 3, 120)).toBe(0);
}

/** A bucket with no samples is skipped, never read as a NaN mean (fails closed). */
export function aBucketWithNoSamplesIsSkipped(): void {
  const empty: MinuteBucket = { bucket: new Date(T0), sumValue: 0, sampleCount: 0, minValue: null, maxValue: null };
  expect(countBacktestFirings([empty], "lt", 3, 120)).toBe(0);
}
