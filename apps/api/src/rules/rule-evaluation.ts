import { BadRequestException } from "@nestjs/common";

import type { AutomationRuleOperator } from "@bms/shared";

import { asCondition } from "./rule-mapping";
import type { EvaluationResult, RuleRow } from "./rules.types";

/**
 * The rule engine's decision logic, with no database and no clock of its own.
 *
 * `RulesService` fetches the telemetry sample and supplies `now`; everything
 * that decides *whether a rule matched* lives here, so it can be tested against
 * a fixed instant rather than whenever CI happens to run.
 */

/** `Date.getDay()` is 0-indexed from Sunday; this maps it to the stored slugs. */
const daySlugs = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Applies a threshold operator. Exhaustive over `AutomationRuleOperator`. */
export function compare(
  value: number,
  operator: AutomationRuleOperator,
  threshold: number,
): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "gte":
      return value >= threshold;
    case "lt":
      return value < threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
  }
}

/** Parses `HH:MM` into minutes past midnight, rejecting anything out of range. */
export function parseTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (
    h === undefined ||
    m === undefined ||
    Number.isNaN(h) ||
    Number.isNaN(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    throw new BadRequestException(`Invalid rule time ${value}`);
  }
  return h * 60 + m;
}

/** Fetches the most recent value for one asset/point, or `null` if there is none. */
export type LatestSampleLoader = (
  assetId: string,
  pointKey: string,
) => Promise<{ time: Date; value: number; unit: string | null } | null>;

/**
 * Decides a threshold rule, loading its telemetry sample through `loadSample`.
 *
 * The loader is a parameter rather than the sample itself so the completeness
 * guard below stays the *only* thing that decides whether a query happens — an
 * incomplete rule is an `error` and must not reach the database. Passing an
 * already-fetched sample would have moved half that guard into the caller and
 * queried on rules that can never evaluate.
 *
 * A `null` sample is `skipped`, not `error`: the rule is well-formed, there is
 * simply no telemetry yet to judge it on.
 */
export async function evaluateThresholdRule(
  row: RuleRow,
  loadSample: LatestSampleLoader,
): Promise<EvaluationResult> {
  if (!row.assetId || !row.pointKey || !row.operator || row.thresholdValue === null) {
    return {
      status: "error",
      matched: false,
      observedValue: null,
      message: "Threshold rule is missing asset, point, operator, or value",
      trace: { ruleType: row.ruleType },
    };
  }

  const sample = await loadSample(row.assetId, row.pointKey);
  if (!sample) {
    return {
      status: "skipped",
      matched: false,
      observedValue: null,
      message: "No telemetry sample available for this rule",
      trace: { assetId: row.assetId, pointKey: row.pointKey },
    };
  }

  const operator = row.operator as AutomationRuleOperator;
  const matched = compare(sample.value, operator, row.thresholdValue);
  return {
    status: matched ? "matched" : "not_matched",
    matched,
    observedValue: sample.value,
    message: matched
      ? `${row.name} matched at ${sample.value}`
      : `${row.name} did not match at ${sample.value}`,
    trace: {
      assetId: row.assetId,
      pointKey: row.pointKey,
      operator,
      thresholdValue: row.thresholdValue,
      sampleTime: sample.time.toISOString(),
      unit: sample.unit,
    },
  };
}

/**
 * Decides a time-window rule at the given instant.
 *
 * A window whose start is after its end wraps past midnight (22:00–06:00), so
 * the comparison flips from `and` to `or` in that case.
 */
export function evaluateTimeWindowRule(row: RuleRow, now: Date): EvaluationResult {
  const condition = asCondition(row.condition);
  if (!("days" in condition)) {
    return {
      status: "error",
      matched: false,
      observedValue: null,
      message: "Time-window rule has invalid condition",
      trace: { condition },
    };
  }

  const day = daySlugs[now.getDay()] ?? "sun";
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const start = parseTime(condition.startTime);
  const end = parseTime(condition.endTime);
  const dayMatches = condition.days.includes(day);
  const timeMatches =
    start <= end
      ? minuteOfDay >= start && minuteOfDay <= end
      : minuteOfDay >= start || minuteOfDay <= end;
  const matched = dayMatches && timeMatches;

  return {
    status: matched ? "matched" : "not_matched",
    matched,
    observedValue: null,
    message: matched
      ? `${row.name} matched the configured time window`
      : `${row.name} is outside the configured time window`,
    trace: {
      day,
      minuteOfDay,
      startTime: condition.startTime,
      endTime: condition.endTime,
    },
  };
}

/** Unsupported rule types are an `error` result, never a thrown exception. */
export function unsupportedRuleType(row: RuleRow): EvaluationResult {
  return {
    status: "error",
    matched: false,
    observedValue: null,
    message: `Unsupported rule type ${row.ruleType}`,
    trace: { ruleType: row.ruleType },
  };
}
