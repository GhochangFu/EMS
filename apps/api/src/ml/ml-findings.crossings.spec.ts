import { expect } from "vitest";

import { crossingsOf, type CrossingPoint, type CrossingRule } from "./ml-findings.crossings";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 3 (plan §4.2 F5, T1.2) — when a
 * forecast is expected to cross its own point's alarm-rule threshold. Pure.
 * Assertions live here; `ml-findings.crossings.test.ts` is the vitest entry
 * point (ADR 0014). Names are made up.
 */
const H = Date.parse("2026-11-17T08:00:00.000Z");
const HOUR_MS = 3_600_000;

/** A point whose p50 at bucket `b` is `p50(b)`, with a band of ±`half`. */
function point(assetId: string, p50: (b: number) => number, opts: { half?: number; unit?: string | null; label?: string } = {}): CrossingPoint {
  const half = opts.half ?? 1;
  return {
    assetId,
    pointKey: "cold_room_temp_c",
    unit: opts.unit === undefined ? "°C" : opts.unit,
    label: opts.label ?? assetId,
    buckets: Array.from({ length: 48 }, (_, b) => ({ ms: H + b * HOUR_MS, p10: p50(b) - half, p50: p50(b), p90: p50(b) + half })),
  };
}

function rule(assetId: string, operator: string, threshold: number, over: Partial<CrossingRule> = {}): CrossingRule {
  return {
    ruleId: `${assetId}-${operator}-${threshold}`,
    assetId,
    pointKey: "cold_room_temp_c",
    name: over.name ?? `High ${assetId}`,
    operator,
    threshold,
    ruleType: "threshold",
    window: "latest",
    unit: null,
    ...over,
  };
}

/** Rising from -20 by 0.5 per hour: crosses -15 at bucket 10. */
const rising = (b: number): number => -20 + 0.5 * b;
/** Falling from -10 by 0.5 per hour: crosses -15 at bucket 10. */
const falling = (b: number): number => -10 - 0.5 * b;
const flat = (): number => -18;

const summary = (c: ReturnType<typeof crossingsOf>[number]): [string, string, number] => [c.kind, c.rule.operator, (c.bucketMs - H) / HOUR_MS];

export function eachCoveredOperatorCrosses(): void {
  expect(crossingsOf([point("a", rising)], [rule("a", "gt", -15)]).map(summary)).toEqual([["expected", "gt", 11]]);
  expect(crossingsOf([point("a", rising)], [rule("a", "gte", -15)]).map(summary)).toEqual([["expected", "gte", 10]]);
  expect(crossingsOf([point("a", falling)], [rule("a", "lt", -15)]).map(summary)).toEqual([["expected", "lt", 11]]);
  expect(crossingsOf([point("a", falling)], [rule("a", "lte", -15)]).map(summary)).toEqual([["expected", "lte", 10]]);
}

export function exactlyAtTheThresholdGtIsNotCrossedGteIs(): void {
  const atThreshold = point("a", () => -15, { half: 0 });
  expect(crossingsOf([atThreshold], [rule("a", "gt", -15)])).toEqual([]);
  expect(crossingsOf([atThreshold], [rule("a", "gte", -15)]).map(summary)).toEqual([["beyond", "gte", 0]]);
}

export function onlyTheBandCrossesUpperForGtLowerForLt(): void {
  // p50 stays at -18; the upper band (p90 = -15.5) crosses -16, the lower band (p10 = -20.5) crosses -20.
  const p = point("a", flat, { half: 2.5 });
  const up = crossingsOf([p], [rule("a", "gt", -16)]);
  expect(up.map(summary)).toEqual([["may", "gt", 0]]);
  expect(up[0]?.band).toBe("upper");
  const down = crossingsOf([p], [rule("a", "lt", -20)]);
  expect(down.map(summary)).toEqual([["may", "lt", 0]]);
  expect(down[0]?.band).toBe("lower");
  // A p50 already beyond wins over the band; a limit past the band's edge gives nothing.
  expect(crossingsOf([p], [rule("a", "gt", -19)]).map(summary), "p50 is above -19 from now").toEqual([["beyond", "gt", 0]]);
  expect(crossingsOf([p], [rule("a", "gt", -15)]), "p90 never reaches -15").toEqual([]);
  expect(crossingsOf([p], [rule("a", "lt", -21)]), "p10 never reaches -21").toEqual([]);
}

export function alreadyBeyondAtBucketZeroIsFromNow(): void {
  // Only bucket 0 is beyond the limit, so a walk that started at bucket 1 would find nothing.
  const spike = point("a", (b) => (b === 0 ? -10 : -20), { half: 0 });
  expect(crossingsOf([spike], [rule("a", "gt", -15)]).map(summary)).toEqual([["beyond", "gt", 0]]);
  const late = point("a", (b) => (b === 1 ? -10 : -20), { half: 0 });
  expect(crossingsOf([late], [rule("a", "gt", -15)]).map(summary)).toEqual([["expected", "gt", 1]]);
}

export function aPointThatNeverCrossesGivesNone(): void {
  expect(crossingsOf([point("a", flat, { half: 0.5 })], [rule("a", "gt", -10), rule("a", "lt", -30)])).toEqual([]);
}

export function eqTimeWindowAndOtherRulesAreSkipped(): void {
  const p = point("a", () => -15, { half: 0 });
  expect(crossingsOf([p], [rule("a", "eq", -15)]), "eq").toEqual([]);
  expect(crossingsOf([p], [rule("a", "gte", -15, { ruleType: "time_window" })]), "time_window").toEqual([]);
  expect(crossingsOf([p], [rule("a", "gte", -15, { window: "avg_5m" })]), "not the latest window").toEqual([]);
  expect(crossingsOf([p], [rule("a", "gte", -15, { window: null })]), "no window").toEqual([]);
  expect(crossingsOf([p], [rule("a", "gte", Number.NaN, { threshold: null })]), "no threshold").toEqual([]);
  expect(crossingsOf([p], [rule("b", "gte", -15)]), "another asset's rule").toEqual([]);
  expect(crossingsOf([p], [rule("a", "gte", -15, { pointKey: "kw" })]), "another point's rule").toEqual([]);
}

export function aRuleUnitThatDiffersIsSkippedAnEqualOrAbsentOneKept(): void {
  const p = point("a", () => -15, { half: 0 });
  expect(crossingsOf([p], [rule("a", "gte", -15, { unit: "°F" })]), "°F against °C").toEqual([]);
  expect(crossingsOf([p], [rule("a", "gte", -15, { unit: "°C" })])).toHaveLength(1);
  expect(crossingsOf([p], [rule("a", "gte", -15, { unit: null })])).toHaveLength(1);
  const unitless = point("a", () => -15, { half: 0, unit: null });
  expect(crossingsOf([unitless], [rule("a", "gte", -15, { unit: "°C" })]), "a unit against none").toEqual([]);
}

export function fourCrossingsGiveTheEarliestThree(): void {
  const points = [0, 1, 2, 3].map((n) => point(`a${n}`, (b) => (b >= 5 + n ? -10 : -20), { half: 0 }));
  const rules = [3, 1, 0, 2].map((n) => rule(`a${n}`, "gt", -15));
  const found = crossingsOf(points, rules);
  expect(found.map((c) => c.point.assetId)).toEqual(["a0", "a1", "a2"]);
}

export function expectedComesBeforeMayAtTheSameHour(): void {
  // Both cross at bucket 6: a's p50, b's upper band only.
  const a = point("a", (b) => (b >= 6 ? -10 : -20), { half: 0, label: "Z label" });
  const b = point("b", (n) => (n >= 6 ? -15.5 : -20), { half: 1, label: "A label" });
  const found = crossingsOf([b, a], [rule("b", "gt", -15), rule("a", "gt", -15)]);
  expect(found.map((c) => [c.kind, c.point.assetId])).toEqual([
    ["expected", "a"],
    ["may", "b"],
  ]);
  // The same hour and kind: by asset label, then rule name.
  const c = point("c", (n) => (n >= 6 ? -10 : -20), { half: 0, label: "A label" });
  const ties = crossingsOf([a, c], [rule("a", "gt", -15), rule("c", "gt", -15, { name: "Second" }), rule("c", "gt", -16, { name: "First" })]);
  expect(ties.map((t) => [t.point.assetId, t.rule.name])).toEqual([
    ["c", "First"],
    ["c", "Second"],
    ["a", "High a"],
  ]);
}
