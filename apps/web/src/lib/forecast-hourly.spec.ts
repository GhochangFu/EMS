import { expect, vi } from "vitest";

import type { PointAggregateBucket } from "@bms/shared";

import { hourlyMeans } from "./forecast-hourly";

/**
 * `E1.4c` (plan R10) — the forecast widget's hourly actual line, pure. Assertions live here;
 * `forecast-hourly.test.ts` is the Vitest entry point (ADR 0014).
 */
const MINUTE = 60_000;
const HOUR_10 = Date.parse("2026-11-16T10:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const bucket = (ms: number, average: number | null, sampleCount: number): PointAggregateBucket => ({
  t: iso(ms),
  v: average,
  min: average,
  average,
  max: average,
  sampleCount,
});

/** The hour's mean is weighted by `sampleCount` (sum / count), never the mean of the bucket means. */
export function theHourIsWeightedBySampleCount(): void {
  const means = hourlyMeans([bucket(HOUR_10, 10, 1), bucket(HOUR_10 + MINUTE, 40, 3)]);
  // (10·1 + 40·3) / 4 = 32.5; the unweighted mean of means would be 25.
  expect(means).toEqual([{ t: iso(HOUR_10), v: 32.5 }]);
}

/** An hour whose buckets hold no sample is `null`, a gap — never zero. */
export function anHourWithNoSamplesIsNull(): void {
  const means = hourlyMeans([
    bucket(HOUR_10, 5, 2),
    bucket(HOUR_10 + 60 * MINUTE, null, 0),
    bucket(HOUR_10 + 61 * MINUTE, 7, 0),
    bucket(HOUR_10 + 120 * MINUTE, 9, 1),
  ]);
  expect(means).toEqual([
    { t: iso(HOUR_10), v: 5 },
    { t: iso(HOUR_10 + 60 * MINUTE), v: null },
    { t: iso(HOUR_10 + 120 * MINUTE), v: 9 },
  ]);
  expect(hourlyMeans([])).toEqual([]);
}

/** A bucket without `average` (the `{ t, v }` shape) falls back to `v`; a bad `t` is skipped. */
export function aBucketWithoutStatsUsesItsValue(): void {
  const means = hourlyMeans([
    { t: iso(HOUR_10), v: 4, sampleCount: 2 },
    { t: "not a time", v: 99, sampleCount: 5 },
  ]);
  expect(means).toEqual([{ t: iso(HOUR_10), v: 4 }]);
}

/**
 * The hour edges are UTC whatever the browser's zone: under `Asia/Kathmandu` (+05:45) the local
 * hour would split 10:00Z–11:00Z at 10:15Z. Ascending, whatever the input order.
 */
export function hourEdgesAreUtcUnderANonUtcZone(): void {
  vi.stubEnv("TZ", "Asia/Kathmandu");
  try {
    expect(new Date(HOUR_10).getMinutes()).toBe(45);
    const means = hourlyMeans([
      bucket(HOUR_10 + 60 * MINUTE, 3, 1),
      bucket(HOUR_10 + 59 * MINUTE, 2, 1),
      bucket(HOUR_10 + 14 * MINUTE, 1, 1),
    ]);
    expect(means).toEqual([
      { t: iso(HOUR_10), v: 1.5 },
      { t: iso(HOUR_10 + 60 * MINUTE), v: 3 },
    ]);
  } finally {
    vi.unstubAllEnvs();
  }
}

/** Given the window, an hour with no bucket at all (an RTU outage) is present and `null`, never joined across. */
export function anHourWithNoBucketIsNullGivenTheWindow(): void {
  const means = hourlyMeans(
    [bucket(HOUR_10 + 5 * MINUTE, 4, 2), bucket(HOUR_10 + 3 * 60 * MINUTE + 5 * MINUTE, 8, 2)],
    HOUR_10 + 2 * MINUTE,
    HOUR_10 + 3 * 60 * MINUTE + 30 * MINUTE,
  );
  expect(means).toEqual([
    { t: iso(HOUR_10), v: 4 },
    { t: iso(HOUR_10 + 60 * MINUTE), v: null },
    { t: iso(HOUR_10 + 120 * MINUTE), v: null },
    { t: iso(HOUR_10 + 180 * MINUTE), v: 8 },
  ]);
  // Without the window the missing hours are simply absent (the old behaviour, kept for a bare call).
  expect(hourlyMeans([bucket(HOUR_10 + 5 * MINUTE, 4, 2)]).map((m) => m.t)).toEqual([iso(HOUR_10)]);
}
