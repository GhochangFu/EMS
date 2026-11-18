import { expect } from "vitest";

import type { DegradationWindow, TrendLimit } from "./degradation-engine.types";
import {
  cutRuleName,
  driftLines,
  formatNumber,
  healthLines,
  rangeWords,
  scheduleNoteSentence,
  withUnit,
  type DriftLineFacts,
  type HealthLineFacts,
  type IndicatorLines,
} from "./degradation-lines";
import { trendOf } from "./degradation-trend";
import { degradationWindow } from "./degradation-window";
import { V1, V2, V7, type TrendVector } from "./trend-math.fixture";

/**
 * `E1.5a` / ADR 0138 (plan §4.9, T1.6, §17 Q1 (a)) — the exact words.
 * Assertions live here; `degradation-lines.test.ts` is the vitest entry point.
 * Every name is made up.
 */
const WINDOW: DegradationWindow = degradationWindow(Date.parse("2026-11-18T06:00:00.000Z"), "Asia/Kolkata");
const RULE = "Fixture high temperature";

function reported(vector: TrendVector, limit: TrendLimit) {
  const outcome = trendOf(vector, limit);
  if (outcome.status === "rejected") throw new Error(`expected a reported trend, got ${outcome.reason}`);
  return outcome;
}

function healthFacts(vector: TrendVector, limit: number): HealthLineFacts {
  const o = reported(vector, { value: limit, direction: "down" });
  return {
    status: o.status,
    daysToLimit: o.daysToLimit,
    current: o.current,
    limit,
    slopePerWeek: o.slope * 7,
    daysWithData: o.n,
    window: WINDOW,
    reachesLabel: "Poor",
    limitBandLabel: "Fair",
  };
}

function driftFacts(limit: number, over: Partial<DriftLineFacts> = {}): DriftLineFacts {
  const o = reported(V7, { value: limit, direction: "up" });
  return {
    status: o.status,
    daysToLimit: o.daysToLimit,
    current: o.current,
    limit,
    slopePerWeek: o.slope * 7,
    daysWithData: o.n,
    window: WINDOW,
    pointKey: "cold_room_temp_c",
    unit: "degC",
    ruleName: RULE,
    direction: "up",
    ...over,
  };
}

const WINDOW_LINE = "Window: 2026-10-21 to 2026-11-17 (28 local days, today not included), Asia/Kolkata.";
const METHOD_LINE =
  "Method: Theil–Sen slope over daily values; Mann–Kendall test (p < 0.05) and a 90 % slope interval that does not include 0.";
const DAYS_LINE = "Days to the limit: from the mean of the last 3 days, at the two ends of the slope interval.";

const healthAssumptions = (days: number, limitPercent: string): string[] => [
  WINDOW_LINE,
  `Coverage: ${days} of 28 days have a value; at least 21 are needed.`,
  `Limit: ${limitPercent}, the lower edge of the Fair band of this asset's template.`,
  "Today's tag weights are applied to past days; each past day was counted with the rules in force on that day.",
  METHOD_LINE,
  DAYS_LINE,
  "Daily value: the health score from the day's in-range counts.",
];

const driftAssumptions = (limit: string): string[] => [
  WINDOW_LINE,
  "Coverage: 22 of 28 days have a value; at least 21 are needed.",
  `Limit: ${limit}, from the rule "${RULE}" in force today.`,
  "The limit is the rule in force today.",
  METHOD_LINE,
  DAYS_LINE,
  "Daily value: the mean of the day's hourly values.",
];

/** P1 — V2 as health toward 0.70: every string, exactly. */
export function p1HealthStringsAreExact(): void {
  expect(healthLines(healthFacts(V2, 0.7))).toEqual({
    summary: "Trending down: reaches Poor in about 13–17 days",
    sentence: "At the trend of the last 28 days, the health score reaches Poor in about 13–17 days.",
    detail: "Now 79% (mean of the last 3 days). Limit 70% (the lower edge of Fair). Change: -4.1 points a week.",
    assumptions: healthAssumptions(21, "70%"),
  });
}

/** P5 — V2 toward 0.30: the range reads "74 to more than 90". */
export function p5HealthRangeReadsToMoreThanNinety(): void {
  const lines = healthLines(healthFacts(V2, 0.3));
  expect(lines.summary).toBe("Trending down: reaches Poor in about 74 to more than 90 days");
  expect(lines.sentence).toBe("At the trend of the last 28 days, the health score reaches Poor in about 74 to more than 90 days.");
  expect(lines.detail).toBe("Now 79% (mean of the last 3 days). Limit 30% (the lower edge of Fair). Change: -4.1 points a week.");
  expect(lines.assumptions).toEqual(healthAssumptions(21, "30%"));
}

/** P4 — V1 toward 0.25: beyond the horizon. */
export function p4HealthBeyondTheHorizon(): void {
  expect(healthLines(healthFacts(V1, 0.25))).toEqual({
    summary: "Trending down: no limit within 90 days",
    sentence: "At the trend of the last 28 days, the health score falls. No limit within 90 days.",
    detail: "Now 77% (mean of the last 3 days). Limit 25% (the lower edge of Fair). Change: -3.5 points a week.",
    assumptions: healthAssumptions(28, "25%"),
  });
}

/** P2 — V7 as drift toward `gt 8` "Fixture high temperature". */
export function p2DriftStringsAreExact(): void {
  expect(driftLines(driftFacts(8))).toEqual({
    summary: "cold_room_temp_c trending up: reaches 8 degC in about 10–12 days",
    sentence: `At the trend of the last 28 days, cold_room_temp_c reaches 8 degC (rule "${RULE}") in about 10–12 days.`,
    detail: `Now 6.85 degC (mean of the last 3 days). Limit 8 degC (rule "${RULE}"). Change: +0.74 degC a week.`,
    assumptions: driftAssumptions("8 degC"),
  });
}

/** Drift beyond the horizon: V7 toward `gt 18`. */
export function driftBeyondTheHorizon(): void {
  const lines = driftLines(driftFacts(18));
  expect(lines.summary).toBe("cold_room_temp_c trending up: no limit within 90 days");
  expect(lines.sentence).toBe(
    `At the trend of the last 28 days, cold_room_temp_c moves toward 18 degC (rule "${RULE}"). No limit within 90 days.`,
  );
}

/** A falling drift reads "trending down" and a negative change. */
export function fallingDriftReadsDown(): void {
  const lines = driftLines({ ...driftFacts(8), direction: "down", slopePerWeek: -1.5 });
  expect(lines.summary).toBe("cold_room_temp_c trending down: reaches 8 degC in about 10–12 days");
  expect(lines.detail).toContain("Change: -1.5 degC a week.");
}

/** A missing unit leaves no gap anywhere. */
export function aMissingUnitLeavesNoGap(): void {
  const lines = driftLines(driftFacts(8, { unit: null }));
  expect(lines.summary).toBe("cold_room_temp_c trending up: reaches 8 in about 10–12 days");
  expect(lines.sentence).toBe(`At the trend of the last 28 days, cold_room_temp_c reaches 8 (rule "${RULE}") in about 10–12 days.`);
  expect(lines.detail).toBe(`Now 6.85 (mean of the last 3 days). Limit 8 (rule "${RULE}"). Change: +0.74 a week.`);
  expect(lines.assumptions[2]).toBe(`Limit: 8, from the rule "${RULE}" in force today.`);
  for (const text of allTexts(lines)) expect(text).not.toMatch(/ {2}| \)| \.|\( /);
  expect(withUnit(3, "")).toBe("3");
}

/** Numbers: at most 2 decimals, trailing zeros dropped; the range dash is U+2013. */
export function numbersAndTheRangeDash(): void {
  expect(formatNumber(6.85)).toBe("6.85");
  expect(formatNumber(8)).toBe("8");
  expect(formatNumber(8.5)).toBe("8.5");
  expect(formatNumber(8.10)).toBe("8.1");
  expect(formatNumber(2.3456)).toBe("2.35");
  expect(formatNumber(-0.001)).toBe("0");
  expect(rangeWords({ min: 13, max: 17 })).toBe("13–17");
  expect(rangeWords({ min: 74, max: null })).toBe("74 to more than 90");
}

/** The schedule note: two figures, `1 day` singular. */
export function theScheduleNote(): void {
  expect(scheduleNoteSentence({ min: 13, max: 17 }, 60)).toBe(
    "Trend reaches its limit in about 13–17 days; next service due in 60 days.",
  );
  expect(scheduleNoteSentence({ min: 74, max: null }, 80)).toBe(
    "Trend reaches its limit in about 74 to more than 90 days; next service due in 80 days.",
  );
  expect(scheduleNoteSentence({ min: 1, max: 2 }, 1)).toBe("Trend reaches its limit in about 1–2 days; next service due in 1 day.");
}

/** A rule name over 120 characters is cut to 120, ending in `…`; 120 is kept whole. */
export function aLongRuleNameIsCut(): void {
  const long = "R".repeat(200);
  const cut = cutRuleName(long);
  expect(Array.from(cut)).toHaveLength(120);
  expect(cut).toBe(`${"R".repeat(119)}…`);
  expect(cutRuleName("R".repeat(120))).toBe("R".repeat(120));
  const lines = driftLines(driftFacts(8, { ruleName: long }));
  expect(lines.sentence).toContain(`(rule "${"R".repeat(119)}…")`);
  expect(lines.sentence).not.toContain("R".repeat(120));
  for (const text of allTexts(lines)) expect(text.length).toBeLessThanOrEqual(500);
}

const allTexts = (lines: IndicatorLines): string[] => [lines.summary, lines.sentence, lines.detail, ...lines.assumptions];

function everyBuiltText(): { health: string[]; drift: string[] } {
  const health = [healthFacts(V2, 0.7), healthFacts(V2, 0.3), healthFacts(V1, 0.25)].flatMap((f) => allTexts(healthLines(f)));
  const drift = [driftFacts(8), driftFacts(18), driftFacts(8, { unit: null })].flatMap((f) => allTexts(driftLines(f)));
  const notes = [scheduleNoteSentence({ min: 13, max: 17 }, 60), scheduleNoteSentence({ min: 74, max: null }, 1)];
  return { health, drift: [...drift, ...notes] };
}

/**
 * No built text names a failure, a useful life, a confidence figure or a
 * `%` other than a health figure; the method line's fixed "90 % slope
 * interval" (plan §4.9) is the one `%` that is not a figure of the indicator.
 */
export function noClaimBeyondTheTrend(): void {
  const { health, drift } = everyBuiltText();
  for (const text of [...health, ...drift]) {
    expect(text).not.toMatch(/remaining useful life/i);
    expect(text).not.toMatch(/\bRUL\b/);
    expect(text).not.toMatch(/fail/i);
    expect(text).not.toMatch(/confidence/i);
  }
  const withoutMethod = (text: string) => text.replace("a 90 % slope interval", "");
  for (const text of drift) expect(withoutMethod(text)).not.toContain("%");
  for (const text of health) expect(withoutMethod(text).replace(/\b\d+%/g, "")).not.toContain("%");
}

/** No built text gives advice. */
export function noAdvice(): void {
  const { health, drift } = everyBuiltText();
  for (const text of [...health, ...drift]) {
    expect(text).not.toMatch(/should|recommend|service early|replace/i);
  }
}
