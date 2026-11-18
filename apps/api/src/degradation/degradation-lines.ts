import {
  DEGRADATION_MAX_HORIZON_DAYS,
  DEGRADATION_MIN_DAYS,
  DEGRADATION_P_VALUE,
  DEGRADATION_RECENT_DAYS,
  DEGRADATION_WINDOW_DAYS,
} from "@bms/shared";

import type { DaysToLimit, DegradationWindow, LimitDirection } from "./degradation-engine.types";

/**
 * `E1.5a` / ADR 0138 (plan §4.9, R-m, §17 Q1 (a)) — the words of a degradation
 * indicator, built on the server. Pure: no database and no clock.
 *
 * Every string is the plan's exact text. The range dash is the en dash
 * (U+2013). Numbers carry at most 2 decimals with trailing zeros dropped; a
 * health figure is a whole percent; a missing unit leaves no gap. The words
 * state figures only: no advice, no failure claim, no confidence figure.
 */

/** The en dash between the two ends of a range. */
const RANGE_DASH = "–";

/** The slope interval's two-sided coverage (`Z_90` is its quantile in `trend-math.ts`). */
const SLOPE_INTERVAL_LEVEL = 0.9;

/** A rule name longer than this many characters is cut, ending in `…`. */
export const RULE_NAME_MAX_CHARS = 120;

const ELLIPSIS = "…";

/** What every indicator's words need. */
interface LineFactsBase {
  readonly status: "crossing" | "beyond_horizon";
  /** `null` for `beyond_horizon`. */
  readonly daysToLimit: DaysToLimit | null;
  readonly current: number;
  readonly limit: number;
  readonly slopePerWeek: number;
  readonly daysWithData: number;
  readonly window: Pick<DegradationWindow, "days" | "zone">;
}

/** A health indicator's facts: values on 0..1. */
export interface HealthLineFacts extends LineFactsBase {
  /** The label of the band below the limit band: the band the score reaches. */
  readonly reachesLabel: string;
  /** The label of the limit band (code `fair`), whose lower edge is the limit. */
  readonly limitBandLabel: string;
}

/** A point drift indicator's facts, in the point's unit. */
export interface DriftLineFacts extends LineFactsBase {
  readonly pointKey: string;
  readonly unit: string | null;
  readonly ruleName: string;
  readonly direction: LimitDirection;
}

/** The words of one indicator. */
export interface IndicatorLines {
  readonly summary: string;
  readonly sentence: string;
  readonly detail: string;
  readonly assumptions: string[];
}

/** At most 2 decimals, trailing zeros dropped; never `-0`. */
export function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(2));
  return String(rounded === 0 ? 0 : rounded);
}

/** A value on 0..1 as a whole percent: `0.785` → `79%`. */
export function formatPercent(value: number): string {
  return `${formatNumber(Math.round(value * 100))}%`;
}

/** A number and its unit; no unit leaves no gap. */
export function withUnit(value: number, unit: string | null): string {
  return unit === null || unit === "" ? formatNumber(value) : `${formatNumber(value)} ${unit}`;
}

/** A signed change, `+` or `-` first. */
const signed = (value: number, digits: string): string => `${value < 0 ? "-" : "+"}${digits}`;

/** A rule name of at most {@link RULE_NAME_MAX_CHARS} characters, cut with `…`. */
export function cutRuleName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= RULE_NAME_MAX_CHARS) return name;
  return `${chars.slice(0, RULE_NAME_MAX_CHARS - 1).join("")}${ELLIPSIS}`;
}

/** `<min>–<max>`, or `<min> to more than <horizon>` when `max` is `null`. */
export function rangeWords(days: DaysToLimit): string {
  return days.max === null
    ? `${days.min} to more than ${DEGRADATION_MAX_HORIZON_DAYS}`
    : `${days.min}${RANGE_DASH}${days.max}`;
}

/** `1 day`, else `<n> days`. */
const dayCount = (n: number): string => (n === 1 ? "1 day" : `${n} days`);

/** The note beside a maintenance schedule: two figures and no action (plan §4.7). */
export function scheduleNoteSentence(days: DaysToLimit, dueInDays: number): string {
  return `Trend reaches its limit in about ${rangeWords(days)} days; next service due in ${dayCount(dueInDays)}.`;
}

const TREND_OPENING = `At the trend of the last ${DEGRADATION_WINDOW_DAYS} days`;
const NO_LIMIT = `no limit within ${DEGRADATION_MAX_HORIZON_DAYS} days`;
const NOW_MEAN = `(mean of the last ${DEGRADATION_RECENT_DAYS} days)`;

const windowLine = (window: LineFactsBase["window"]): string =>
  `Window: ${window.days[0]} to ${window.days[window.days.length - 1]} (${DEGRADATION_WINDOW_DAYS} local days, today not included), ${window.zone}.`;
const coverageLine = (daysWithData: number): string =>
  `Coverage: ${daysWithData} of ${DEGRADATION_WINDOW_DAYS} days have a value; at least ${DEGRADATION_MIN_DAYS} are needed.`;
const METHOD_LINE = `Method: Theil–Sen slope over daily values; Mann–Kendall test (p < ${DEGRADATION_P_VALUE}) and a ${Math.round(SLOPE_INTERVAL_LEVEL * 100)} % slope interval that does not include 0.`;
const DAYS_LINE = `Days to the limit: from the mean of the last ${DEGRADATION_RECENT_DAYS} days, at the two ends of the slope interval.`;

/** §17 Q1 (a): what each indicator's past days actually hold. */
export const HEALTH_RULES_LINE =
  "Today's tag weights are applied to past days; each past day was counted with the rules in force on that day.";
export const DRIFT_RULES_LINE = "The limit is the rule in force today.";

/** The words of a health indicator (plan §4.9). */
export function healthLines(facts: HealthLineFacts): IndicatorLines {
  const days = facts.daysToLimit;
  const summary =
    days === null
      ? `Trending down: ${NO_LIMIT}`
      : `Trending down: reaches ${facts.reachesLabel} in about ${rangeWords(days)} days`;
  const sentence =
    days === null
      ? `${TREND_OPENING}, the health score falls. No limit within ${DEGRADATION_MAX_HORIZON_DAYS} days.`
      : `${TREND_OPENING}, the health score reaches ${facts.reachesLabel} in about ${rangeWords(days)} days.`;
  const points = facts.slopePerWeek * 100;
  const detail =
    `Now ${formatPercent(facts.current)} ${NOW_MEAN}. ` +
    `Limit ${formatPercent(facts.limit)} (the lower edge of ${facts.limitBandLabel}). ` +
    `Change: ${signed(points, Math.abs(points).toFixed(1))} points a week.`;
  return {
    summary,
    sentence,
    detail,
    assumptions: [
      windowLine(facts.window),
      coverageLine(facts.daysWithData),
      `Limit: ${formatPercent(facts.limit)}, the lower edge of the ${facts.limitBandLabel} band of this asset's template.`,
      HEALTH_RULES_LINE,
      METHOD_LINE,
      DAYS_LINE,
      "Daily value: the health score from the day's in-range counts.",
    ],
  };
}

/** The words of a point drift indicator (plan §4.9). */
export function driftLines(facts: DriftLineFacts): IndicatorLines {
  const days = facts.daysToLimit;
  const limit = withUnit(facts.limit, facts.unit);
  const rule = `rule "${cutRuleName(facts.ruleName)}"`;
  const trending = `${facts.pointKey} trending ${facts.direction}`;
  const summary =
    days === null ? `${trending}: ${NO_LIMIT}` : `${trending}: reaches ${limit} in about ${rangeWords(days)} days`;
  const sentence =
    days === null
      ? `${TREND_OPENING}, ${facts.pointKey} moves toward ${limit} (${rule}). No limit within ${DEGRADATION_MAX_HORIZON_DAYS} days.`
      : `${TREND_OPENING}, ${facts.pointKey} reaches ${limit} (${rule}) in about ${rangeWords(days)} days.`;
  const change = signed(facts.slopePerWeek, withUnit(Math.abs(facts.slopePerWeek), facts.unit));
  const detail =
    `Now ${withUnit(facts.current, facts.unit)} ${NOW_MEAN}. ` + `Limit ${limit} (${rule}). ` + `Change: ${change} a week.`;
  return {
    summary,
    sentence,
    detail,
    assumptions: [
      windowLine(facts.window),
      coverageLine(facts.daysWithData),
      `Limit: ${limit}, from the ${rule} in force today.`,
      DRIFT_RULES_LINE,
      METHOD_LINE,
      DAYS_LINE,
      "Daily value: the mean of the day's hourly values.",
    ],
  };
}
