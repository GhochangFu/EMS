import {
  DEGRADATION_MAX_HORIZON_DAYS,
  DEGRADATION_MIN_DAYS,
  DEGRADATION_MIN_HORIZON_DAYS,
  DEGRADATION_P_VALUE,
  DEGRADATION_RECENT_DAYS,
  DEGRADATION_WINDOW_DAYS,
} from "@bms/shared";

import type {
  DailySeries,
  DaysToLimit,
  TrendFigures,
  TrendLimit,
  TrendLimitFinder,
  TrendOutcome,
  TrendReason,
} from "./degradation-engine.types";
import { mannKendall, theilSen } from "./trend-math";

/**
 * `E1.5a` / ADR 0138 (plan §4.4, R-e, R-g) — the trend rule and the projection.
 * Pure: no database and no clock.
 *
 * The steps run in order and the first that fails ends it with a reason:
 * coverage, a recent value, a significant trend whose interval excludes 0, a
 * slope toward the limit, a current value not yet past it, then the horizon.
 */

/** The first day index of the window's last days, whose values make the current value (R-e). */
const FIRST_RECENT_X = DEGRADATION_WINDOW_DAYS - DEGRADATION_RECENT_DAYS;

/** Each quotient of the range is rounded to this many decimals before `floor` or `ceil` (R-g). */
const QUOTIENT_DECIMALS = 6;
const QUOTIENT_SCALE = 10 ** QUOTIENT_DECIMALS;

const roundQuotient = (value: number): number => Math.round(value * QUOTIENT_SCALE) / QUOTIENT_SCALE;

/**
 * The days until `distance` is covered (R-g): `min` at the steepest slope of
 * the interval, `max` at the gentlest. Equal ends become `min` and `min + 1`;
 * a `max` above the horizon is `null` ("to more than 90").
 */
export function daysRange(distance: number, steepest: number, gentlest: number): DaysToLimit {
  const d = Math.abs(distance);
  const min = Math.max(DEGRADATION_MIN_HORIZON_DAYS, Math.floor(roundQuotient(d / Math.abs(steepest))));
  let max = Math.ceil(roundQuotient(d / Math.abs(gentlest)));
  if (max <= min) max = min + 1;
  return { min, max: max > DEGRADATION_MAX_HORIZON_DAYS ? null : max };
}

/** Whether the slope runs toward a limit in `direction`. */
const runsToward = (limit: TrendLimit, slope: number): boolean =>
  limit.direction === "down" ? slope < 0 : slope > 0;

/** Whether `current` is already beyond the limit. */
const isPast = (limit: TrendLimit, current: number): boolean =>
  limit.direction === "down" ? current < limit.value : current > limit.value;

/**
 * The trend of a daily series toward `limit` (plan §4.4). `limit` is fixed
 * (health) or found from the current value and the median slope (point drift,
 * §4.6); a finder answering `null` means no limit lies ahead.
 */
export function trendOf<L extends TrendLimit>(series: DailySeries, limit: L | TrendLimitFinder<L>): TrendOutcome<L> {
  const { xs, ys } = series;
  const n = ys.length;
  const figures: TrendFigures = { n, current: null, slope: null, low: null, high: null, p: null };
  const reject = (reason: TrendReason, at: TrendFigures, found: L | null = null): TrendOutcome<L> => ({
    ...at,
    status: "rejected",
    reason,
    limit: found,
  });

  // 1. Coverage.
  if (n < DEGRADATION_MIN_DAYS) return reject("coverage", figures);

  // 2. A value in the window's last days; their mean is the current value.
  const recent = ys.filter((_, i) => xs[i]! >= FIRST_RECENT_X);
  if (recent.length === 0) return reject("stale", figures);
  const current = recent.reduce((sum, y) => sum + y, 0) / recent.length;

  // 3. A significant trend whose interval excludes 0 (an end of exactly 0 includes it).
  const { p } = mannKendall(ys);
  const { slope, low, high } = theilSen(xs, ys);
  const measured: TrendFigures = { n, current, slope, low, high, p };
  if (!(p < DEGRADATION_P_VALUE && (low > 0 || high < 0))) return reject("no_trend", measured);

  // 4. The slope points at the limit.
  const found = typeof limit === "function" ? limit(current, slope) : limit;
  if (found === null || !runsToward(found, slope)) return reject("not_toward_limit", measured, found);

  // 5. Not already past it.
  if (isPast(found, current)) return reject("already_past", measured, found);

  // 6. The projection: the median slope decides the horizon; the interval gives the range.
  const distance = Math.abs(found.value - current);
  // Rounded as the range's quotients are (R-g), so float noise cannot move a crossing at the horizon.
  const point = roundQuotient(distance / Math.abs(slope));
  if (point < DEGRADATION_MIN_HORIZON_DAYS) return reject("under_one_day", measured, found);
  const reported = { n, current, slope, low, high, p, limit: found };
  if (point > DEGRADATION_MAX_HORIZON_DAYS) return { ...reported, status: "beyond_horizon", daysToLimit: null };
  const [steepest, gentlest] = Math.abs(low) >= Math.abs(high) ? [low, high] : [high, low];
  return { ...reported, status: "crossing", daysToLimit: daysRange(distance, steepest, gentlest) };
}
