import { expect } from "vitest";

import { countBacktestFirings, type MinuteBucket } from "./rule-backtest";

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9) — the 7-day backtest's pure core. Each
 * series is one value per minute from a fixed instant; a value is a bucket's
 * mean, written as `sumValue` with `sampleCount: 1` unless the case is about
 * the mean. The hold is 120 s unless stated.
 */

const T0 = Date.UTC(2026, 9, 20, 0, 0, 0);
const MINUTE = 60_000;

/** A bucket at minute `minute` whose mean is `value`. */
function at(minute: number, value: number, sampleCount = 1): MinuteBucket {
  return { bucket: new Date(T0 + minute * MINUTE), sumValue: value * sampleCount, sampleCount };
}

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

/** The bucket mean is compared: 10 over 4 samples is 2.5, below a threshold of 3, so nothing fires. */
export function theMeanIsWhatIsCompared(): void {
  const bucket: MinuteBucket = { bucket: new Date(T0), sumValue: 10, sampleCount: 4 };
  expect(countBacktestFirings([bucket], "gt", 3, 120)).toBe(0);
  // Positive control: the same sum over 2 samples is a mean of 5, which fires.
  expect(countBacktestFirings([{ ...bucket, sampleCount: 2 }], "gt", 3, 120)).toBe(1);
}

/** A bucket with no samples is skipped, never read as a NaN mean (fails closed). */
export function aBucketWithNoSamplesIsSkipped(): void {
  const empty: MinuteBucket = { bucket: new Date(T0), sumValue: 0, sampleCount: 0 };
  expect(countBacktestFirings([empty], "lt", 3, 120)).toBe(0);
}
