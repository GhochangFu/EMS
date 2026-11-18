import { DEGRADATION_P_VALUE } from "@bms/shared";
import { expect } from "vitest";

import type { DailySeries, TrendLimit, TrendOutcome } from "./degradation-engine.types";
import { daysRange, trendOf } from "./degradation-trend";
import { V1, V11, V2, V6, V7, V9, type TrendVector } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan §4.4, R-e, R-g, T1.5) — the trend rule and the projection.
 * Assertions live here; `degradation-trend.test.ts` is the vitest entry point.
 *
 * A vector of fewer than 28 values with `x` 0..n−1 is placed on the window's
 * last days (`x` shifted by 28 − n), as a real series ending yesterday is.
 */
const atWindowEnd = (vector: TrendVector): DailySeries => {
  const last = vector.xs[vector.xs.length - 1]!;
  const shift = 27 - last;
  return { xs: vector.xs.map((x) => x + shift), ys: vector.ys };
};
const health = (value: number): TrendLimit => ({ value, direction: "down" });

function expectCrossing(outcome: TrendOutcome, current: number, min: number, max: number | null): void {
  expect(outcome.status).toBe("crossing");
  expect(outcome.current).toBeCloseTo(current, 9);
  if (outcome.status !== "crossing") return;
  expect(outcome.daysToLimit).toEqual({ min, max });
}

function expectRejected(outcome: TrendOutcome, reason: string): void {
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") expect(outcome.reason).toBe(reason);
}

/** P1 — V2 as health, limit 0.70: current 0.785, crossing in 13–17 days. */
export function p1NoisyFallCrossesInThirteenToSeventeenDays(): void {
  const outcome = trendOf(V2, health(0.7));
  expectCrossing(outcome, 0.785, 13, 17);
  expect(outcome.n).toBe(21);
  expect(outcome.slope).toBeCloseTo(-0.0058823529, 9);
  expect(outcome.low).toBeCloseTo(-0.0065217391, 9);
  expect(outcome.high).toBeCloseTo(-0.005, 9);
  expect(outcome.p).toBeLessThan(1e-6);
  expect(outcome.limit).toEqual(health(0.7));
}

/** P2 — V7 as drift toward a `gt 8` rule: current 6.85, crossing in 10–12 days. */
export function p2RiseCrossesTheRuleAheadInTenToTwelveDays(): void {
  const rule = { value: 8, direction: "up" as const, name: "Fixture high temperature" };
  const seen: [number, number][] = [];
  const outcome = trendOf(V7, (current, slope) => {
    seen.push([current, slope]);
    return slope > 0 && rule.value > current ? rule : null;
  });
  expectCrossing(outcome, 6.85, 10, 12);
  expect(outcome.limit).toBe(rule);
  expect(seen).toHaveLength(1);
  expect(seen[0]![0]).toBeCloseTo(6.85, 9);
  expect(seen[0]![1]).toBeCloseTo(0.105, 9);
}

/** P3 — V1 as health, limit 0.70: current 0.77; equal ends widen to 14–15. */
export function p3EqualEndsWidenByOne(): void {
  expectCrossing(trendOf(V1, health(0.7)), 0.77, 14, 15);
}

/** P4 — V1, limit 0.25: 104 days → beyond the horizon, no range. */
export function p4BeyondTheHorizonHasNoRange(): void {
  const outcome = trendOf(V1, health(0.25));
  expect(outcome.status).toBe("beyond_horizon");
  if (outcome.status === "beyond_horizon") expect(outcome.daysToLimit).toBeNull();
}

/** P5 — V2, limit 0.30: 82.45 days → crossing, 74 to more than 90. */
export function p5LongCrossingReadsToMoreThanNinety(): void {
  expectCrossing(trendOf(V2, health(0.3)), 0.785, 74, null);
}

/** P6 — V2, limit 0.80: the current value is already past it. */
export function p6AlreadyPast(): void {
  expectRejected(trendOf(V2, health(0.8)), "already_past");
}

/** P7 — V9 as health: `p` passes but the interval holds 0 (`high` is exactly 0). */
export function p7IntervalHoldingZeroIsNoTrend(): void {
  const outcome = trendOf(atWindowEnd(V9), health(80));
  expectRejected(outcome, "no_trend");
  expect(outcome.p).toBeLessThan(DEGRADATION_P_VALUE);
  expect(outcome.high).toBe(0);
}

/** P8 — V11 as health: the interval excludes 0 but `p` is 0.087. */
export function p8PAboveTheLevelIsNoTrend(): void {
  const outcome = trendOf(atWindowEnd(V11), health(60));
  expectRejected(outcome, "no_trend");
  expect(outcome.high).toBeLessThan(0);
}

/** P9 — V1's days 0–24 without days 3, 9, 15, 20 (n 21): nothing in the last 3 days. */
export function p9NothingInTheLastThreeDaysIsStale(): void {
  const keep = V1.xs.filter((x) => x <= 24 && ![3, 9, 15, 20].includes(x));
  const outcome = trendOf({ xs: keep, ys: keep.map((x) => V1.ys[x]!) }, health(0.7));
  expect(outcome.n).toBe(21);
  expectRejected(outcome, "stale");
}

/** P10 — V1's days 0–19 moved to x 8–27 (n 20): too few days. */
export function p10TwentyDaysIsCoverage(): void {
  const outcome = trendOf({ xs: V1.xs.slice(0, 20).map((x) => x + 8), ys: V1.ys.slice(0, 20) }, health(0.7));
  expect(outcome.n).toBe(20);
  expectRejected(outcome, "coverage");
}

/** P11 — each quotient is rounded to 6 decimals before `floor` and `ceil`. */
export function p11QuotientsAreRoundedFirst(): void {
  expect(0.3 / 0.1).toBe(2.9999999999999996);
  expect(daysRange(0.3, 0.1, 0.05)).toEqual({ min: 3, max: 6 });
}

/** P12 — V7 (rising) as health toward 0.70: the slope points away. */
export function p12RisingHealthIsNotTowardTheLimit(): void {
  expectRejected(trendOf(V7, health(0.7)), "not_toward_limit");
}

/** A limit finder that answers `null` (no rule ahead) is `not_toward_limit`. */
export function aFinderWithNoRuleAheadIsNotTowardTheLimit(): void {
  expectRejected(
    trendOf(V7, () => null),
    "not_toward_limit",
  );
}

/** P13 — V1, limit 0.768: under one day away. */
export function p13UnderOneDayIsNotReported(): void {
  expectRejected(trendOf(V1, health(0.768)), "under_one_day");
}

/** `low` or `high` exactly 0 counts as "includes 0", whichever way the series runs. */
export function anIntervalEndOfExactlyZeroIncludesZero(): void {
  const falling = atWindowEnd(V6);
  const down = trendOf(falling, health(0.5));
  expectRejected(down, "no_trend");
  expect(down.p).toBeLessThan(DEGRADATION_P_VALUE);
  expect(down.high).toBe(0);
  const rising = trendOf({ xs: falling.xs, ys: falling.ys.map((y) => 2 - y) }, { value: 1.5, direction: "up" });
  expectRejected(rising, "no_trend");
  expect(rising.p).toBeLessThan(DEGRADATION_P_VALUE);
  expect(rising.low).toBe(0);
}

/** R-g: `min` is at least 1, equal ends widen by one, a `max` above 90 is `null`. */
export function daysRangeKeepsItsBounds(): void {
  expect(daysRange(0.5, 1, 0.5)).toEqual({ min: 1, max: 2 });
  expect(daysRange(10, 1, 1)).toEqual({ min: 10, max: 11 });
  expect(daysRange(10, -2, -1)).toEqual({ min: 5, max: 10 });
  expect(daysRange(90, 1, 1)).toEqual({ min: 90, max: null });
  expect(daysRange(45, 1, 0.5)).toEqual({ min: 45, max: 90 });
  expect(daysRange(45.5, 1, 0.5)).toEqual({ min: 45, max: null });
}

/**
 * The median slope decides the horizon, not the range's `min`: V2 toward 0.235
 * is 93.5 days at the median slope (beyond) though the steepest end gives 84.
 */
export function theMedianSlopeDecidesTheHorizon(): void {
  const outcome = trendOf(V2, health(0.235));
  expect(outcome.status).toBe("beyond_horizon");
  expect(daysRange(0.785 - 0.235, outcome.low!, outcome.high!).min).toBe(84);
}
