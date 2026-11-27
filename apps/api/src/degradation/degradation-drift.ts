import type { DegradationIndicator } from "@bms/shared";

import { covers, type CrossingPoint, type CrossingRule } from "../ml/ml-findings.crossings";
import { toCrossingRule } from "../ml/ml-findings.forecast-facts";
import type { DegradationWindow, DriftLimit, DriftPointInput, MeanDay } from "./degradation-engine.types";
import { driftLines } from "./degradation-lines";
import { trendOf } from "./degradation-trend";
import { seriesOf } from "./degradation-window";

/**
 * `E1.5a` / ADR 0138 (plan §4.6, R-d, R-l, §17 Q2 (a)) — point drift. Pure:
 * no database and no clock.
 *
 * A day has a value when its Σ`sample_count` is above 0. The rules are
 * `E1.9`'s covered rules (`toCrossingRule`, then `covers`: no operator or unit
 * logic is written twice). The limit is the covered rule nearest the current
 * value **ahead** of it in the slope's direction: `gt`/`gte` above it when
 * rising, `lt`/`lte` below it when falling. A rule already passed is behind,
 * so the next one ahead is used. Ties by rule name, then id. No severity is read.
 */

const RISING_OPERATORS: ReadonlySet<string> = new Set(["gt", "gte"]);
const FALLING_OPERATORS: ReadonlySet<string> = new Set(["lt", "lte"]);

/** Plain code-unit order: stable whatever the locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The point's rules that `covers` holds, mapped by `toCrossingRule` (R-l). */
export function coveredRulesOf(assetId: string, point: DriftPointInput): CrossingRule[] {
  const crossingPoint: CrossingPoint = {
    assetId,
    pointKey: point.pointKey,
    unit: point.unit,
    label: point.pointKey,
    buckets: [],
  };
  return point.rules.map(toCrossingRule).filter((rule) => covers(crossingPoint, rule));
}

/** The nearest covered rule ahead of `current` in the direction of `slope`, or `null` (plan §4.6, Q2 (a)). */
export function nearestRuleAhead(rules: readonly CrossingRule[], current: number, slope: number): DriftLimit | null {
  const rising = slope > 0;
  if (!rising && !(slope < 0)) return null;
  const operators = rising ? RISING_OPERATORS : FALLING_OPERATORS;
  const ahead = rules.filter(
    (rule): rule is CrossingRule & { threshold: number } =>
      operators.has(rule.operator) &&
      rule.threshold !== null &&
      (rising ? rule.threshold > current : rule.threshold < current),
  );
  ahead.sort(
    (a, b) =>
      Math.abs(a.threshold - current) - Math.abs(b.threshold - current) ||
      byCodeUnit(a.name, b.name) ||
      byCodeUnit(a.ruleId, b.ruleId),
  );
  const rule = ahead[0];
  if (rule === undefined) return null;
  return { value: rule.threshold, direction: rising ? "up" : "down", ruleId: rule.ruleId, ruleName: rule.name };
}

/** Each local day's mean (R-d): only days whose Σ`sample_count` is above 0 and whose mean is a number. */
export function dailyMeans(days: readonly MeanDay[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const row of days) {
    if (row.sampleCount > 0 && row.mean !== null && Number.isFinite(row.mean)) values.set(row.day, row.mean);
  }
  return values;
}

/** The point's drift indicator, or `null` when it has no covered rule or no reported trend. */
export function driftIndicatorOf(
  assetId: string,
  point: DriftPointInput,
  window: DegradationWindow,
): DegradationIndicator | null {
  const rules = coveredRulesOf(assetId, point);
  if (rules.length === 0) return null;
  const outcome = trendOf(seriesOf(window.days, dailyMeans(point.days)), (current, slope) =>
    nearestRuleAhead(rules, current, slope),
  );
  if (outcome.status === "rejected") return null;
  const { limit } = outcome;
  const slopePerWeek = outcome.slope * 7;
  const lines = driftLines({
    status: outcome.status,
    daysToLimit: outcome.daysToLimit,
    current: outcome.current,
    limit: limit.value,
    slopePerWeek,
    daysWithData: outcome.n,
    window,
    pointKey: point.pointKey,
    unit: point.unit,
    ruleName: limit.ruleName,
    direction: limit.direction,
  });
  return {
    id: `${assetId}:point_drift:${point.pointKey}`,
    kind: "point_drift",
    status: outcome.status,
    pointKey: point.pointKey,
    unit: point.unit,
    current: outcome.current,
    limit: limit.value,
    limitSource: { kind: "rule", name: limit.ruleName },
    slopePerWeek,
    daysToLimit: outcome.daysToLimit,
    daysWithData: outcome.n,
    ...lines,
  };
}
