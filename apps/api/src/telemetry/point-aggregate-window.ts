import type { PointAggregateFunction } from "@bms/shared";

import {
  type AggregateLevel,
  aggregateRelation,
  avgExpr,
  bucketSeconds,
  levelForRange,
} from "./point-aggregates";

/**
 * `F3.35` Stage A (ADR 0048 decision 3) — the pure half of the general aggregate
 * read: which level to read, which window, and which SQL expression.
 *
 * Everything here is a string, a number or a `Date`. The query itself is
 * `TelemetryService.pointAggregate`; the database behaviour is
 * `point-aggregates.integration.spec.ts`'s territory.
 *
 * This module exists beside `point-aggregates.ts` rather than inside it because
 * that file is ADR 0023's read helper, shared by seven call sites including the
 * reports path, and `F3.35` should not widen a module six other features depend
 * on. It imports `aggregateRelation`, `avgExpr` and `levelForRange` and adds no
 * second copy of any of them.
 */

/**
 * Window length in minutes at or below which each rung applies, coarsest last.
 *
 * The same shape `DashboardService.energySummary` already uses: the display
 * granularity is chosen from the window, arithmetically, **before any row is
 * read**. That is what makes {@link MAX_BUCKETS} a derived bound rather than a
 * declared one, and it is why this endpoint can never widen a bucket at request
 * time — there is no runtime branch that could.
 */
const LADDER: readonly { readonly maxWindowMinutes: number; readonly granularity: AggregateLevel }[] = [
  { maxWindowMinutes: 2_880, granularity: "1m" }, // 48 h
  { maxWindowMinutes: 43_200, granularity: "1h" }, // 30 d
  { maxWindowMinutes: 525_600, granularity: "1d" }, // 365 d — MAX_WIDGET_WINDOW_MINUTES
];

/**
 * The most buckets one response may carry, **derived from the ladder** rather
 * than declared beside it.
 *
 * Recomputed here so that moving a rung boundary, or adding a rung, moves this
 * number with it. `point-aggregate-window.spec.ts` asserts both that this equals
 * 2,880 today and that no rung exceeds it — so a change that blows the bound
 * fails a test rather than arriving as a slow chart.
 *
 * For scale: `TelemetryService.recentForPoint` already returns up to 5,000 raw
 * readings into the same `ChartWidget`. The worst case here is 58% of that.
 */
export const MAX_BUCKETS = Math.max(
  ...LADDER.map((rung) => Math.ceil(rung.maxWindowMinutes / (bucketSeconds(rung.granularity) / 60))),
);

/** The display granularity a window of this length is read at. */
export function granularityFor(windowMinutes: number): AggregateLevel {
  for (const rung of LADDER) {
    if (windowMinutes <= rung.maxWindowMinutes) {
      return rung.granularity;
    }
  }
  // Unreachable through `pointAggregateQuerySchema`, whose `.max()` is the last
  // rung's bound. Types erase at runtime and this decides which relation gets
  // read, so it fails loudly rather than defaulting to the coarsest level.
  throw new Error(
    `granularityFor: ${windowMinutes} minutes exceeds the coarsest rung ` +
      `(${LADDER[LADDER.length - 1]?.maxWindowMinutes}); the query schema should have refused it`,
  );
}

/** The two windows a request reads. `compareTo` always equals `from` — see below. */
export interface AggregateWindow {
  readonly from: Date;
  readonly to: Date;
  /** `null` unless a compare was asked for. */
  readonly compareFrom: Date | null;
  readonly compareTo: Date | null;
  /**
   * The earliest instant the request touches — `compareFrom ?? from`.
   *
   * This, not `from`, is what {@link levelForRange} must be given: the retention
   * guard asks whether a level still holds data as old as the range start, and
   * with a compare on, the range starts one window earlier.
   */
  readonly readStart: Date;
}

/**
 * The window, and the immediately preceding window of the same length.
 *
 * `compareTo === from` exactly: the two abut, with no gap and no overlap. A gap
 * would compare against a period the operator did not ask about, and an overlap
 * would count the same samples on both sides of a percentage.
 *
 * `now` is an **argument**, never read from the clock inside this function
 * (`tests/repo-invariants.test.ts` enforces the rule for pure builders), so a
 * test can pin it and the caller controls it.
 */
export function windowBounds(
  now: Date,
  windowMinutes: number,
  compare: boolean,
): AggregateWindow {
  const spanMs = windowMinutes * 60_000;
  const to = now;
  const from = new Date(now.getTime() - spanMs);
  const compareTo = compare ? from : null;
  const compareFrom = compare ? new Date(from.getTime() - spanMs) : null;
  return { from, to, compareFrom, compareTo, readStart: compareFrom ?? from };
}

/**
 * The level to read, given the window and whether a compare doubles its reach.
 *
 * Returns only the level. `LevelChoice.coarsened` is deliberately not surfaced,
 * and that is safe rather than an oversight: the ladder bounds every request so
 * that escalation is unreachable. At `1m` the deepest reach is 2 x 48 h = 96
 * hours against a 735-day horizon, and `_1h`/`_1d` carry no horizon at all by
 * ADR 0023 decision 7. `tests/f3.35-aggregate-window-bounds.test.ts` holds that
 * arithmetic against the real retention numbers, so if a horizon is ever
 * shortened this becomes a failing test rather than a silently coarser chart.
 */
export function levelFor(window: AggregateWindow, windowMinutes: number, now: Date): AggregateLevel {
  return levelForRange({
    start: window.readStart,
    granularity: granularityFor(windowMinutes),
    now,
  }).level;
}

/**
 * The four aggregate expressions, as a closed `Record`.
 *
 * **The one table serves both queries** — the scalar statistics and the bucket
 * rows — which is the whole reason `bucketSql` groups by a column it is already
 * grouped by. See {@link bucketSql}.
 *
 * `avg` is the only computed one. There is **no `avg_value` column**: ADR 0023
 * stores `sum_value` and `sample_count` precisely so the division happens at
 * read time where the weights are still known. The form that used to be the trap
 * — `avg(avg_value)` — no longer even typechecks, because the column is gone.
 * **The mistake that does typecheck now is `avg(sum_value)`**, which averages
 * bucket totals and is wrong by a factor of the samples per bucket.
 *
 * The `sum(sample_count) > 0` guard goes AROUND `avgExpr()`, never inside it:
 * `point-aggregates.spec.ts` pins that function's exact output string and six
 * live call sites in `dashboard.service.ts` and `reports.service.ts` depend on
 * it. The guard is not dead code — `sample_count` is `count(value)`, so a bucket
 * whose samples are all `NULL` yields a row with a zero denominator.
 */
const AGG_EXPR: Record<PointAggregateFunction, string> = {
  sum: "sum(sum_value)::float8",
  avg: `CASE WHEN sum(sample_count) > 0 THEN ${avgExpr()}::float8 END`,
  min: "min(min_value)::float8",
  max: "max(max_value)::float8",
};

/**
 * The expression for one function, by closed-`Record` lookup.
 *
 * `Object.hasOwn` rather than a bare index — the same prototype-key guard
 * `aggregateRelation` uses. The function name arrives as a query parameter, so
 * although `pointAggregateFunctionSchema` has already narrowed it to four
 * members, **it never reaches SQL as a string**: it is a key, and the value it
 * selects is a literal in this file.
 */
export function aggregateExpression(fn: PointAggregateFunction): string | undefined {
  return Object.hasOwn(AGG_EXPR, fn) ? AGG_EXPR[fn] : undefined;
}

/** Every relation this module reads is chosen by {@link granularityFor}, never by a caller. */
function relationFor(level: AggregateLevel): string {
  const relation = aggregateRelation(level);
  if (relation === undefined) {
    throw new Error(`point-aggregate-window: no relation for level "${level}"`);
  }
  return relation;
}

/**
 * A `$n` placeholder, for composing these fragments into one statement.
 *
 * The service puts the current window's scalars, the compare window's scalars
 * and the bucket rows in **one statement** so they share a transaction snapshot
 * — two statements could straddle an incoming write and make the footer
 * disagree with the plot it sits under. That means the same fragment is emitted
 * twice with different parameter numbers, so the numbers are arguments.
 *
 * They are numbers, not strings, and they are checked. An index is the one thing
 * here that a caller supplies and that reaches the SQL text, so it may not be
 * anything but a positive integer.
 */
function placeholder(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`point-aggregate-window: refusing a non-positional parameter index ${index}`);
  }
  return `$${index}`;
}

/**
 * The scalar statistics — all four functions at once, unconditionally.
 *
 * The chart footer needs Peak and Average simultaneously and the tile needs one
 * of the four, so computing all four costs one pass and removes the need for a
 * function parameter on this half of the request entirely.
 *
 * `peak_at` is the bucket whose `max_value` is highest. **The `bucket ASC`
 * tie-break is required**: two equal peaks without it make the tile flicker
 * between reads and any test on it flaky.
 */
export function scalarSql(level: AggregateLevel, fromIndex = 3, toIndex = 4): string {
  const relation = relationFor(level);
  const from = placeholder(fromIndex);
  const to = placeholder(toIndex);
  return `
    SELECT
      ${AGG_EXPR.sum} AS sum,
      ${AGG_EXPR.avg} AS average,
      ${AGG_EXPR.min} AS min,
      ${AGG_EXPR.max} AS max,
      coalesce(sum(sample_count), 0)::bigint AS sample_count,
      (
        SELECT p.bucket
        FROM ${relation} p
        WHERE p.asset_id = $1 AND p.point_key = $2
          AND p.bucket >= ${from}::timestamptz AND p.bucket < ${to}::timestamptz
        ORDER BY p.max_value DESC NULLS LAST, p.bucket ASC
        LIMIT 1
      ) AS peak_at
    FROM ${relation}
    WHERE asset_id = $1 AND point_key = $2
      AND bucket >= ${from}::timestamptz AND bucket < ${to}::timestamptz
  `;
}

/**
 * The plotted buckets — one function, resolved server-side.
 *
 * **The `GROUP BY bucket` is degenerate, and it must stay.** At the chosen level
 * there is exactly one source row per output bucket, so every aggregate folds
 * 1 to 1 and the group is arithmetically pointless. It is here so that the
 * **same {@link AGG_EXPR} table serves this query and {@link scalarSql}**.
 * Simplify it into row-level expressions and `avg` becomes
 * `sum_value / NULLIF(sample_count, 0)` — a second copy of the mean, in the
 * place `avgExpr` exists to prevent one. A reviewer will reach for this
 * simplification; this paragraph is the answer.
 *
 * `LIMIT MAX_BUCKETS + 1` so {@link assertBucketCount} can tell "at the bound"
 * from "past it". Truncating a chart silently is the same class of defect as
 * widening a bucket silently.
 */
export function bucketSql(
  fn: PointAggregateFunction,
  level: AggregateLevel,
  fromIndex = 3,
  toIndex = 4,
): string {
  const expression = aggregateExpression(fn);
  if (expression === undefined) {
    throw new Error(`bucketSql: unknown aggregate function "${fn}"`);
  }
  return `
    SELECT bucket AS t, ${expression} AS v
    FROM ${relationFor(level)}
    WHERE asset_id = $1 AND point_key = $2
      AND bucket >= ${placeholder(fromIndex)}::timestamptz
      AND bucket < ${placeholder(toIndex)}::timestamptz
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT ${MAX_BUCKETS + 1}
  `;
}

/**
 * Refuses an over-long bucket array rather than truncating it.
 *
 * Reachable only if the ladder and a relation disagree — a continuous
 * aggregate's bucket width changed without `BUCKET_SECONDS` following. In that
 * state a chart would silently plot a prefix of its window, which looks exactly
 * like a sensor that stopped reporting.
 */
export function assertBucketCount(rowCount: number): void {
  if (rowCount > MAX_BUCKETS) {
    throw new Error(
      `point aggregate returned ${rowCount} buckets, past the ${MAX_BUCKETS} the ladder admits. ` +
        "The chosen level's bucket width and BUCKET_SECONDS disagree; refusing rather than " +
        "plotting a truncated window, which is indistinguishable from a dead sensor.",
    );
  }
}
