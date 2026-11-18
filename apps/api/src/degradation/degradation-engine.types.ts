import type { TemplateHealth } from "@bms/shared";

import type { ThresholdRuleDbRow } from "../ml/ml-findings.forecast-facts";

/**
 * `E1.5a` / ADR 0138 (plan §4.2, §4.4–§4.8) — the shapes the pure degradation
 * engine passes between its parts, and the input the service feeds it. No
 * database and no clock here.
 */

/** One zone's window: the 28 complete local days before today (plan R-a). */
export interface DegradationWindow {
  readonly zone: string;
  /** `YYYY-MM-DD`, oldest first; day index `x` is the position in this list. */
  readonly days: readonly string[];
  /** The local midnight that starts `days[0]`, epoch ms. */
  readonly fromMs: number;
  /** The local midnight that starts today (the window's end, exclusive), epoch ms. */
  readonly toMs: number;
}

/** A daily series: ascending day index `x`, only the days with a value (plan R-d). */
export interface DailySeries {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** Which way a value must move to reach its limit. */
export type LimitDirection = "down" | "up";

/** A limit and the way toward it. */
export interface TrendLimit {
  readonly value: number;
  readonly direction: LimitDirection;
}

/**
 * Finds the limit for a series from its current value and its median slope
 * (point drift, plan §4.6: the nearest covered rule ahead). `null` means no
 * limit lies ahead: the trend is `not_toward_limit`.
 */
export type TrendLimitFinder<L extends TrendLimit = TrendLimit> = (current: number, slope: number) => L | null;

/** Why a series gives no reported trend (for tests and logs, never the wire). */
export type TrendReason = "coverage" | "stale" | "no_trend" | "not_toward_limit" | "already_past" | "under_one_day";

/** The days until a limit is reached: `max: null` reads "to more than 90". */
export interface DaysToLimit {
  readonly min: number;
  readonly max: number | null;
}

/** The figures every outcome carries; each is `null` until the step that sets it has run. */
export interface TrendFigures {
  /** The number of days with a value. */
  readonly n: number;
  /** The mean of the values in the window's last 3 local days. */
  readonly current: number | null;
  readonly slope: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly p: number | null;
}

/** A series that gives no reported trend, and why. */
export interface TrendRejected<L extends TrendLimit = TrendLimit> extends TrendFigures {
  readonly status: "rejected";
  readonly reason: TrendReason;
  /** The limit, once one was found (steps 4 onward). */
  readonly limit: L | null;
}

/** A reported trend: `crossing` with a range, or `beyond_horizon` with none. */
export interface TrendReported<L extends TrendLimit = TrendLimit> {
  readonly status: "crossing" | "beyond_horizon";
  readonly n: number;
  readonly current: number;
  readonly slope: number;
  readonly low: number;
  readonly high: number;
  readonly p: number;
  readonly limit: L;
  readonly daysToLimit: DaysToLimit | null;
}

/** What `trendOf` answers. */
export type TrendOutcome<L extends TrendLimit = TrendLimit> = TrendRejected<L> | TrendReported<L>;

/** A health limit (plan R-i): the lower edge of the band whose code is `fair`. */
export interface HealthLimit extends TrendLimit {
  readonly direction: "down";
  /** The label of the band directly below the limit band in the template's list. */
  readonly reachesLabel: string;
  /** The label of the limit band itself. */
  readonly limitBandLabel: string;
}

/** A drift limit (plan §4.6, §17 Q2 (a)): the nearest covered rule ahead. */
export interface DriftLimit extends TrendLimit {
  readonly ruleId: string;
  readonly ruleName: string;
}

/**
 * One tag's counters on one local day, from `telemetry.point_in_range_1h`:
 * Σ`in_range_count`, Σ`sample_count`, max `rule_count`, max
 * `skipped_rule_count` (plan §4.5, the live read's own rule).
 */
export interface CounterDay {
  /** `YYYY-MM-DD`, the local day in the asset's zone. */
  readonly day: string;
  readonly pointKey: string;
  readonly inRangeCount: number;
  readonly sampleCount: number;
  readonly ruleCount: number;
  readonly skippedRuleCount: number;
}

/** One point's mean on one local day: Σ`sum_value` ÷ Σ`sample_count` and Σ`sample_count`. */
export interface MeanDay {
  readonly day: string;
  readonly mean: number | null;
  readonly sampleCount: number;
}

/** One drift point of an asset (plan R-k): its daily means and the rules the `E1.9` read returned for it. */
export interface DriftPointInput {
  readonly pointKey: string;
  readonly unit: string | null;
  readonly days: readonly MeanDay[];
  /** `readThresholdRules` rows; only those `covers` holds are used (plan R-l). */
  readonly rules: readonly ThresholdRuleDbRow[];
}

/** Everything the engine needs for one considered asset. */
export interface DegradationAssetInput {
  readonly assetId: string;
  readonly organizationId: string;
  readonly locationId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly assetRtuName: string | null;
  readonly assetLocationName: string;
  /** The window of the asset's zone (`degradationWindow`); its `zone` is the response's `timeZone`. */
  readonly window: DegradationWindow;
  /** The template's parsed `health` block (`healthForAssets`); `undefined` gives no health indicator. */
  readonly health: TemplateHealth | undefined;
  readonly counterDays: readonly CounterDay[];
  readonly driftPoints: readonly DriftPointInput[];
}

/** One active maintenance schedule of an asset (plan §4.7). */
export interface ScheduleInput {
  readonly scheduleId: string;
  readonly assetId: string;
  /** `next_due_at`, epoch ms. */
  readonly nextDueMs: number;
}
