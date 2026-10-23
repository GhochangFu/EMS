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
 * **An estimate, and the card says so.** A bucket matches when its **mean**
 * (`sum_value / sample_count`; the aggregate has no `avg` column) passes the
 * rule's comparison, so a 1-minute bucket can hide a shorter excursion — the
 * ADR's own caveat. The rule's clear hold is applied as the live lifecycle
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
};

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
 * bucket with no samples (or a non-finite mean) is skipped — it neither matches
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
  for (const bucket of buckets) {
    if (bucket.bucket === null || bucket.sumValue === null || bucket.sampleCount === null || bucket.sampleCount <= 0) continue;
    const mean = bucket.sumValue / bucket.sampleCount;
    if (!Number.isFinite(mean)) continue;
    const at = bucket.bucket.getTime();
    if (compare(mean, operator, threshold)) {
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
    .select({ bucket: pointValues1m.bucket, sumValue: pointValues1m.sumValue, sampleCount: pointValues1m.sampleCount })
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
