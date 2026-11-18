/**
 * `E1.5a` / ADR 0138 (plan §4.2, §4.4) — the shapes the pure degradation
 * engine passes between its parts. No database and no clock here.
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
