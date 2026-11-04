import { expect } from "vitest";

import { inputKey } from "../calc/calc-batch";
import { bucketTimeMs } from "../calc/calc-schedule";
import {
  asOfIndex,
  asOfInputs,
  BACKFILL_CHUNK_BUCKETS,
  BACKFILL_MAX_SAMPLE_ROWS,
  bucketGrid,
  bucketsPerChunk,
  chunk,
  parametersAt,
} from "./calc-backfill-plan";

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill's pure arithmetic. One
 * claim per exported function, and the worst case the plan sized the chunk
 * by (31 days at the 10 s floor).
 */

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);
const KEY = inputKey("asset-1", "kw");

/** Every bucket is an instant `bucketTimeMs` would produce — the sweep's own grid. */
export function theGridIsAlignedWithBucketTimeMs(): void {
  const grid = bucketGrid(T0 + 7_000, T0 + 600_000, 60);
  expect(grid.filter((t) => bucketTimeMs(t, 60) !== t)).toEqual([]);
}

/** The grid starts at the first bucket at or after `from` and is half-open at `to`. */
export function theGridIsHalfOpen(): void {
  expect(bucketGrid(T0 + 1, T0 + 180_000, 60)).toEqual([T0 + 60_000, T0 + 120_000]);
}

/** 31 days at 10 s is 267,840 buckets. */
export function theWorstCaseIs267840Buckets(): void {
  expect(bucketGrid(T0, T0 + 31 * DAY_MS, 10)).toHaveLength(267_840);
}

/** …which is 536 chunks of 500. */
export function theWorstCaseIs536Chunks(): void {
  expect(chunk(bucketGrid(T0, T0 + 31 * DAY_MS, 10), BACKFILL_CHUNK_BUCKETS)).toHaveLength(536);
}

/** A chunk never holds more than its size. */
export function noChunkExceedsItsSize(): void {
  expect(Math.max(...chunk(bucketGrid(T0, T0 + DAY_MS, 10), BACKFILL_CHUNK_BUCKETS).map((c) => c.length))).toBe(
    BACKFILL_CHUNK_BUCKETS,
  );
}

/** One input pair keeps the full chunk of 500. */
export function oneInputKeepsTheFullChunk(): void {
  expect(bucketsPerChunk(1)).toBe(BACKFILL_CHUNK_BUCKETS);
}

/** 300 input pairs shrink the chunk to ⌊100,000 / 300⌋ = 333, so a chunk reads at most the cap. */
export function manyInputsShrinkTheChunk(): void {
  expect(bucketsPerChunk(300)).toBe(Math.floor(BACKFILL_MAX_SAMPLE_ROWS / 300));
}

/** For every pair count up to the cap, pairs × buckets stays within the cap. */
export function pairsTimesBucketsNeverExceedsTheCap(): void {
  const over = [1, 2, 199, 200, 201, 333, 1_000, 99_999, BACKFILL_MAX_SAMPLE_ROWS].filter(
    (pairs) => pairs * bucketsPerChunk(pairs) > BACKFILL_MAX_SAMPLE_ROWS,
  );
  expect(over).toEqual([]);
}

/** More pairs than the cap still walk, one bucket at a time (the read itself refuses past the cap). */
export function morePairsThanTheCapWalkOneBucketAtATime(): void {
  expect(bucketsPerChunk(BACKFILL_MAX_SAMPLE_ROWS * 2)).toBe(1);
}

const SAMPLES = new Map([
  [
    KEY,
    [
      { timeMs: T0 + 20_000, value: 2 },
      { timeMs: T0, value: 1 },
      { timeMs: T0 + 40_000, value: 3 },
    ],
  ],
]);

/** Between two samples, the older one answers. */
export function latestAtOrBeforeReturnsTheNewestOlderSample(): void {
  expect(asOfIndex(SAMPLES).latestAtOrBefore(KEY, T0 + 30_000)?.value).toBe(2);
}

/** A sample stamped exactly at `t` is the answer at `t` (at or before, inclusive). */
export function latestAtOrBeforeIncludesASampleAtTheSameInstant(): void {
  expect(asOfIndex(SAMPLES).latestAtOrBefore(KEY, T0 + 20_000)?.value).toBe(2);
}

/** Nothing after `t` is ever served: before the first sample there is no answer. */
export function latestAtOrBeforeNeverServesALaterSample(): void {
  expect(asOfIndex(SAMPLES).latestAtOrBefore(KEY, T0 - 1)).toBeUndefined();
}

/** A question earlier than the previous one restarts the cursor rather than serving a later sample. */
export function anEarlierQuestionRestartsTheCursor(): void {
  const index = asOfIndex(SAMPLES);
  index.latestAtOrBefore(KEY, T0 + 40_000);
  expect(index.latestAtOrBefore(KEY, T0 + 10_000)?.value).toBe(1);
}

/** The inputs fake keys `getLatestSamples` by point key, as `CalcInputsService` does. */
export async function asOfInputsKeysLocalReadsByPointKey(): Promise<void> {
  const read = await asOfInputs(asOfIndex(SAMPLES), T0 + 30_000).getLatestSamples("asset-1", ["kw", "kvar"]);
  expect([...read.entries()]).toEqual([["kw", { timeMs: T0 + 20_000, value: 2 }]]);
}

/** The parameter map at `t` holds only the pairs a row covers at `t`. */
export function parametersAtOmitsAnUncoveredPair(): void {
  const series = new Map([
    ["a:k", [{ fromMs: 0, toMs: 100, value: 7, rank: 0 }]],
    ["b:k", [{ fromMs: 200, toMs: null, value: 9, rank: 0 }]],
  ]);
  expect([...parametersAt(series, 50).entries()]).toEqual([["a:k", 7]]);
}
