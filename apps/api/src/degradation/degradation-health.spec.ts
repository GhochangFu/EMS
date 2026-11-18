import { degradationIndicatorSchema, type TemplateHealth } from "@bms/shared";
import { expect } from "vitest";

import { scoreAsset } from "../asset-health/health-score";
import type { CounterDay } from "./degradation-engine.types";
import { dailyHealthValues, healthIndicatorOf, healthLimitOf } from "./degradation-health";
import { countersOf, FX_HEALTH, FX_STANDARD_BANDS, FX_WINDOW, fxUuid } from "./degradation.fixture";
import { theilSen } from "./trend-math";
import { V2, V7 } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan §4.5, R-d, R-i, T1.5) — the health trend.
 * Assertions live here; `degradation-health.test.ts` is the vitest entry point.
 */
const ASSET = fxUuid("aaaaaaaa", 1);
const DAY = FX_WINDOW.days[10]!;

const tag = (pointKey: string, inRangeCount: number, over: Partial<CounterDay> = {}): CounterDay => ({
  day: DAY,
  pointKey,
  inRangeCount,
  sampleCount: 1000,
  ruleCount: 1,
  skippedRuleCount: 0,
  ...over,
});

/** A day's value is `scoreAsset`'s score for the same counts. */
export function aDaysValueIsScoreAssetsScore(): void {
  const rows = [tag("a", 900), tag("b", 500), tag("c", 0, { ruleCount: 0, sampleCount: 0, skippedRuleCount: 1 })];
  const expected = scoreAsset(
    rows.map(({ day: _day, ...counts }) => counts),
    FX_HEALTH,
  ).score;
  expect(dailyHealthValues(rows, FX_HEALTH).get(DAY)).toBe(expected);
}

/** Weights `{ a: 3, b: 1 }` change the daily score against equal weights. */
export function weightsChangeTheDailyScore(): void {
  const rows = [tag("a", 900), tag("b", 500)];
  const equal = dailyHealthValues(rows, FX_HEALTH).get(DAY);
  const weighted = dailyHealthValues(rows, { ...FX_HEALTH, weights: { a: 3, b: 1 } }).get(DAY);
  expect(equal).toBeCloseTo(0.7, 12);
  expect(weighted).toBeCloseTo(0.8, 12);
}

/** A day whose only tag has `ruleCount 0` has no value; a day with no row has none either. */
export function anUnruledDayHasNoValue(): void {
  const other = FX_WINDOW.days[11]!;
  const values = dailyHealthValues([tag("a", 0, { ruleCount: 0 }), tag("a", 800, { day: other })], FX_HEALTH);
  expect(values.has(DAY)).toBe(false);
  expect(values.get(other)).toBeCloseTo(0.8, 12);
  expect(values.size).toBe(1);
}

/** No `health`, no `fair` band, or `fair` last → no limit and no indicator, whatever the counters. */
export function noFairBandMeansNoIndicator(): void {
  const counters = countersOf(V2);
  const noFair: TemplateHealth = { bands: FX_STANDARD_BANDS.filter((b) => b.code !== "fair") };
  const fairLast: TemplateHealth = {
    bands: [
      { code: "good", label: "Good", minScore: 0.85 },
      { code: "fair", label: "Fair", minScore: 0 },
    ],
  };
  const fairLabelOnly: TemplateHealth = {
    bands: FX_STANDARD_BANDS.map((b) => (b.code === "fair" ? { ...b, code: "medium", label: "fair" } : b)),
  };
  for (const health of [undefined, noFair, fairLast, fairLabelOnly]) {
    expect(healthLimitOf(health)).toBeNull();
    expect(healthIndicatorOf(ASSET, health, counters, FX_WINDOW)).toBeNull();
  }
  expect(healthIndicatorOf(ASSET, FX_HEALTH, counters, FX_WINDOW)).not.toBeNull();
}

/** The band word is the next band's label: `fair` then "Degraded" reads "reaches Degraded". */
export function theBandWordIsTheNextBandsLabel(): void {
  const health: TemplateHealth = {
    bands: [
      { code: "good", label: "Good", minScore: 0.85 },
      { code: "fair", label: "Usable", minScore: 0.7 },
      { code: "worn", label: "Degraded", minScore: 0 },
    ],
  };
  expect(healthLimitOf(health)).toEqual({ value: 0.7, direction: "down", reachesLabel: "Degraded", limitBandLabel: "Usable" });
  const indicator = healthIndicatorOf(ASSET, health, countersOf(V2), FX_WINDOW)!;
  expect(indicator.summary).toBe("Trending down: reaches Degraded in about 13–17 days");
  expect(indicator.limitSource).toEqual({ kind: "band", name: "Usable" });
  expect(indicator.detail).toContain("(the lower edge of Usable)");
}

/** P1 through the counters: V2 as daily scores toward the standard `fair` edge, 0.70. */
export function p1FromTheCounters(): void {
  const indicator = healthIndicatorOf(ASSET, FX_HEALTH, countersOf(V2), FX_WINDOW)!;
  expect(indicator).not.toBeNull();
  expect(degradationIndicatorSchema.parse(indicator)).toEqual(indicator);
  expect(indicator.id).toBe(`${ASSET}:health`);
  expect(indicator.kind).toBe("health");
  expect(indicator.status).toBe("crossing");
  expect(indicator.pointKey).toBeNull();
  expect(indicator.unit).toBeNull();
  expect(indicator.current).toBeCloseTo(0.785, 12);
  expect(indicator.limit).toBe(0.7);
  expect(indicator.limitSource).toEqual({ kind: "band", name: "Fair" });
  expect(indicator.daysToLimit).toEqual({ min: 13, max: 17 });
  expect(indicator.daysWithData).toBe(21);
  expect(indicator.sentence).toBe("At the trend of the last 28 days, the health score reaches Poor in about 13–17 days.");
  expect(indicator.assumptions).toHaveLength(7);
}

/** `slopePerWeek` is the median daily slope × 7. */
export function slopePerWeekIsSlopeTimesSeven(): void {
  const indicator = healthIndicatorOf(ASSET, FX_HEALTH, countersOf(V2), FX_WINDOW)!;
  expect(indicator.slopePerWeek).toBe(theilSen(V2.xs, V2.ys).slope * 7);
  expect(indicator.slopePerWeek).toBeCloseTo(-0.0411764706, 9);
}

/** A rising score, or a row on a day outside the window, gives nothing extra. */
export function aRisingScoreAndOutsideRowsGiveNothing(): void {
  const rising = countersOf({ id: "up", xs: V7.xs, ys: V7.ys.map((y) => y / 10) });
  expect(healthIndicatorOf(ASSET, FX_HEALTH, rising, FX_WINDOW)).toBeNull();
  const outside: CounterDay = { ...tag("t1", 0), day: "2026-11-18" };
  const withOutside = healthIndicatorOf(ASSET, FX_HEALTH, [...countersOf(V2), outside], FX_WINDOW)!;
  expect(withOutside.daysWithData).toBe(21);
  expect(withOutside.daysToLimit).toEqual({ min: 13, max: 17 });
}
