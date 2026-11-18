import { degradationIndicatorSchema } from "@bms/shared";
import { expect } from "vitest";

import { coveredRulesOf, dailyMeans, driftIndicatorOf, nearestRuleAhead } from "./degradation-drift";
import { FX_RULE_NAME, FX_WINDOW, fxDriftPoint, fxRule, fxUuid, meansOf } from "./degradation.fixture";
import { V7, type TrendVector } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan §4.6, R-d, R-l, §17 Q2 (a), T1.5) — point drift.
 * Assertions live here; `degradation-drift.test.ts` is the vitest entry point.
 */
const ASSET = fxUuid("aaaaaaaa", 2);
const shifted = (by: number): TrendVector => ({ id: `V7+${by}`, xs: V7.xs, ys: V7.ys.map((y) => y + by) });
const falling: TrendVector = { id: "12−V7", xs: V7.xs, ys: V7.ys.map((y) => 12 - y) };

/** P2 — V7 rising toward `gt 8`: that rule, 10–12 days. */
export function risingTowardGtEightTakesThatRule(): void {
  const rule = fxRule(ASSET, "gt", 8);
  const indicator = driftIndicatorOf(ASSET, fxDriftPoint(meansOf(V7), [rule]), FX_WINDOW)!;
  expect(indicator).not.toBeNull();
  expect(degradationIndicatorSchema.parse(indicator)).toEqual(indicator);
  expect(indicator.id).toBe(`${ASSET}:point_drift:cold_room_temp_c`);
  expect(indicator.kind).toBe("point_drift");
  expect(indicator.status).toBe("crossing");
  expect(indicator.pointKey).toBe("cold_room_temp_c");
  expect(indicator.unit).toBe("degC");
  expect(indicator.current).toBeCloseTo(6.85, 12);
  expect(indicator.limit).toBe(8);
  expect(indicator.limitSource).toEqual({ kind: "rule", name: FX_RULE_NAME });
  expect(indicator.daysToLimit).toEqual({ min: 10, max: 12 });
  expect(indicator.daysWithData).toBe(22);
  expect(indicator.slopePerWeek).toBeCloseTo(0.735, 9);
  expect(indicator.summary).toBe("cold_room_temp_c trending up: reaches 8 degC in about 10–12 days");
}

/** Q2 (a): a `gt 7` rule already passed with a `gt 9` ahead → the 9 rule. */
export function aPassedRuleGivesWayToTheNextAhead(): void {
  const passed = fxRule(ASSET, "gt", 7, { rule_name: "Fixture warm" });
  const ahead = fxRule(ASSET, "gt", 9, { rule_name: "Fixture hot" });
  const indicator = driftIndicatorOf(ASSET, fxDriftPoint(meansOf(shifted(1)), [passed, ahead]), FX_WINDOW)!;
  expect(indicator).not.toBeNull();
  expect(indicator.current).toBeCloseTo(7.85, 12);
  expect(indicator.limit).toBe(9);
  expect(indicator.limitSource.name).toBe("Fixture hot");
  expect(indicator.status).toBe("crossing");
}

/** Falling with only `gt` rules → none; a `lt` rule below → that rule, trending down. */
export function fallingNeedsARuleBelow(): void {
  const gtOnly = [fxRule(ASSET, "gt", 8), fxRule(ASSET, "gte", 10)];
  expect(driftIndicatorOf(ASSET, fxDriftPoint(meansOf(falling), gtOnly), FX_WINDOW)).toBeNull();
  const below = fxRule(ASSET, "lt", 4, { rule_name: "Fixture low temperature" });
  const indicator = driftIndicatorOf(ASSET, fxDriftPoint(meansOf(falling), [...gtOnly, below]), FX_WINDOW)!;
  expect(indicator.limit).toBe(4);
  expect(indicator.summary).toMatch(/^cold_room_temp_c trending down: reaches 4 degC in about /);
}

/** Two rules ahead → the nearer; equal thresholds → by name, then id. */
export function theNearerRuleAheadWins(): void {
  const rules = coveredRulesOf(
    ASSET,
    fxDriftPoint(
      [],
      [
        fxRule(ASSET, "gt", 10, { rule_id: fxUuid("cccccccc", 1), rule_name: "A far" }),
        fxRule(ASSET, "gte", 8, { rule_id: fxUuid("cccccccc", 3), rule_name: "B near" }),
        fxRule(ASSET, "gt", 8, { rule_id: fxUuid("cccccccc", 4), rule_name: "A near" }),
        fxRule(ASSET, "gt", 8, { rule_id: fxUuid("cccccccc", 2), rule_name: "A near" }),
        fxRule(ASSET, "lt", 6.9, { rule_id: fxUuid("cccccccc", 5), rule_name: "A below" }),
      ],
    ),
  );
  expect(rules).toHaveLength(5);
  expect(nearestRuleAhead(rules, 6.85, 0.1)).toEqual({
    value: 8,
    direction: "up",
    ruleId: fxUuid("cccccccc", 2),
    ruleName: "A near",
  });
  expect(nearestRuleAhead(rules, 8, 0.1)?.value).toBe(10);
  expect(nearestRuleAhead(rules, 7, -0.1)).toEqual({
    value: 6.9,
    direction: "down",
    ruleId: fxUuid("cccccccc", 5),
    ruleName: "A below",
  });
  expect(nearestRuleAhead(rules, 10, 0.1)).toBeNull();
  expect(nearestRuleAhead(rules, 7, 0)).toBeNull();
}

/** A rule whose unit differs from the point's is skipped (through `covers`); a matching or absent unit is kept. */
export function aRuleInAnotherUnitIsSkipped(): void {
  const degF = fxRule(ASSET, "gt", 8, { rule_unit: "degF" });
  expect(driftIndicatorOf(ASSET, fxDriftPoint(meansOf(V7), [degF]), FX_WINDOW)).toBeNull();
  const degC = fxRule(ASSET, "gt", 8, { rule_unit: "degC" });
  expect(driftIndicatorOf(ASSET, fxDriftPoint(meansOf(V7), [degF, degC]), FX_WINDOW)?.limit).toBe(8);
  const nearerInDegF = fxRule(ASSET, "gt", 7.5, { rule_unit: "degF" });
  expect(driftIndicatorOf(ASSET, fxDriftPoint(meansOf(V7), [nearerInDegF, degC]), FX_WINDOW)?.limit).toBe(8);
}

/** No covered rule → none: no rule, another point's rule, a non-`latest` window, a `neq` operator, no threshold. */
export function noCoveredRuleIsNoIndicator(): void {
  const uncovered = [
    fxRule(ASSET, "gt", 8, { point_key: "other_point" }),
    fxRule(fxUuid("aaaaaaaa", 99), "gt", 8),
    fxRule(ASSET, "gt", 8, { rule_window: "avg_15m" }),
    fxRule(ASSET, "neq", 8),
    fxRule(ASSET, "gt", 8, { threshold_value: null }),
  ];
  expect(driftIndicatorOf(ASSET, fxDriftPoint(meansOf(V7), []), FX_WINDOW)).toBeNull();
  expect(driftIndicatorOf(ASSET, fxDriftPoint(meansOf(V7), uncovered), FX_WINDOW)).toBeNull();
}

/** A day has a value only when its Σ`sample_count` is above 0 and its mean is a number. */
export function aDayNeedsSamples(): void {
  const [d0, d1, d2] = FX_WINDOW.days;
  const values = dailyMeans([
    { day: d0!, mean: 5, sampleCount: 24 },
    { day: d1!, mean: 5, sampleCount: 0 },
    { day: d2!, mean: null, sampleCount: 3 },
  ]);
  expect([...values]).toEqual([[d0, 5]]);
  const thinned = meansOf(V7).map((row, i) => (i < 2 ? { ...row, sampleCount: 0 } : row));
  expect(driftIndicatorOf(ASSET, fxDriftPoint(thinned, [fxRule(ASSET, "gt", 8)]), FX_WINDOW)).toBeNull();
}
