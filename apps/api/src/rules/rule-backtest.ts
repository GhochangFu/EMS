import { and, asc, eq, gte, lt } from "drizzle-orm";

import { pointValues1m } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AutomationRuleOperator } from "@bms/shared";

import { compare } from "./rule-evaluation";

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9 — the owner's own choice) — the 7-day
 * backtest a copilot rule card shows: "would have fired about N times in the
 * last 7 days (estimate)". New read code, write-free, bounded to one point and
 * 7 days of the 1-minute aggregate (≤ 10,080 rows).
 *
 * **An estimate, and the card says so.** Owner ruling 2026-10-24 (`F4.278`
 * Q1): a bucket matches when the value the operator looks at passes the
 * rule's comparison — the bucket's **max** (`max_value`) for `gt` and `gte`,
 * its **min** (`min_value`) for `lt` and `lte`, and its **mean**
 * (`sum_value / sample_count`; the aggregate has no `avg` column) for `eq`,
 * the only other operator `AutomationRuleOperator` has. So an excursion
 * inside a minute counts even when the minute's mean stays normal; an `eq`
 * rule can still miss an instant the mean hides — the ADR's own caveat. A
 * bucket is "normal" when that same value does not match. The rule's clear hold is applied as the live lifecycle
 * applies it: once firing, the state returns to inactive only after the value
 * has stayed normal for at least the hold, measured by bucket timestamps (so a
 * gap in the buckets advances time by the gap).
 */

/** The 7-day window, in milliseconds (Amendment 8: never longer). */
export const BACKTEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** One 1-minute bucket of the point, as the backtest reads it. */
export type MinuteBucket = {
  readonly bucket: Date | null;
  readonly sumValue: number | null;
  readonly sampleCount: number | null;
  readonly minValue: number | null;
  readonly maxValue: number | null;
};

/** Which bucket value an operator compares (ruling Q1). */
export type BacktestBasis = "max" | "min" | "mean";

/** `gt`/`gte` compare the max, `lt`/`lte` the min, `eq` the mean (owner ruling 2026-10-24, `F4.278` Q1). */
export function backtestBasis(operator: AutomationRuleOperator): BacktestBasis {
  switch (operator) {
    case "gt":
    case "gte":
      return "max";
    case "lt":
    case "lte":
      return "min";
    case "eq":
      return "mean";
  }
}

/** The bucket's value for `basis`, or `null` when it has none to compare (fails closed). */
function bucketValue(bucket: MinuteBucket, basis: BacktestBasis): number | null {
  if (bucket.sampleCount === null || bucket.sampleCount <= 0) return null;
  const value =
    basis === "max" ? bucket.maxValue : basis === "min" ? bucket.minValue : bucket.sumValue === null ? null : bucket.sumValue / bucket.sampleCount;
  return value !== null && Number.isFinite(value) ? value : null;
}

/** The threshold rule a backtest replays. */
export type BacktestRule = {
  readonly assetId: string;
  readonly pointKey: string;
  readonly operator: AutomationRuleOperator;
  readonly thresholdValue: number;
  /** The hold already defaulted by the caller (`DEFAULT_CLEAR_HOLD_SECONDS` for a `null`). */
  readonly clearHoldSeconds: number;
};

export type BacktestResult = {
  /** How many times the rule would have fired. */
  readonly firings: number;
  /** How many buckets the estimate read; `0` means there was no history to estimate from. */
  readonly buckets: number;
};

/**
 * The pure core: counts the firings over `buckets` (ascending by time). A
 * bucket with no samples, or with no finite value for the operator's basis (a
 * `null` max, min or sum, a non-finite mean), is skipped — it neither matches
 * nor counts as normal, so a guard on it fails closed.
 */
export function countBacktestFirings(
  buckets: readonly MinuteBucket[],
  operator: AutomationRuleOperator,
  threshold: number,
  clearHoldSeconds: number,
): number {
  const holdMs = clearHoldSeconds * 1000;
  let firings = 0;
  let active = false;
  let normalSince: number | null = null;
  const basis = backtestBasis(operator);
  for (const bucket of buckets) {
    if (bucket.bucket === null) continue;
    const value = bucketValue(bucket, basis);
    if (value === null) continue;
    const at = bucket.bucket.getTime();
    if (compare(value, operator, threshold)) {
      if (!active) {
        firings += 1;
        active = true;
      }
      normalSince = null;
      continue;
    }
    if (!active) continue;
    if (normalSince === null) normalSince = at;
    if (at - normalSince >= holdMs) {
      active = false;
      normalSince = null;
    }
  }
  return firings;
}

/**
 * The one loader: the point's 1-minute buckets in `[now − 7 d, now)`, ascending.
 * On the tenant pool: `telemetry.*` carries no RLS, and the target resolver has
 * already placed the asset in the turn's scope under the route's own gate.
 */
export async function loadMinuteBuckets(
  db: BmsDb,
  assetId: string,
  pointKey: string,
  now: Date,
): Promise<MinuteBucket[]> {
  const from = new Date(now.getTime() - BACKTEST_WINDOW_MS);
  return db
    .select({
      bucket: pointValues1m.bucket,
      sumValue: pointValues1m.sumValue,
      sampleCount: pointValues1m.sampleCount,
      minValue: pointValues1m.minValue,
      maxValue: pointValues1m.maxValue,
    })
    .from(pointValues1m)
    .where(
      and(
        eq(pointValues1m.assetId, assetId),
        eq(pointValues1m.pointKey, pointKey),
        gte(pointValues1m.bucket, from),
        lt(pointValues1m.bucket, now),
      ),
    )
    .orderBy(asc(pointValues1m.bucket));
}

/** Loads the point's last 7 days and counts the firings. Writes nothing. */
export async function backtestRule(db: BmsDb, rule: BacktestRule, now: Date): Promise<BacktestResult> {
  const buckets = await loadMinuteBuckets(db, rule.assetId, rule.pointKey, now);
  return {
    firings: countBacktestFirings(buckets, rule.operator, rule.thresholdValue, rule.clearHoldSeconds),
    buckets: buckets.length,
  };
}
