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
 * `F4.291` PR 3 (ADR 0099 Amendment 9 E5(c)) — the levels `get_point_stats`
 * reads for `[from, to)`: the statistics at the ladder's level for the
 * window's length, and `last` at `1m` (owner ruling P6: the newest 1-minute
 * bucket's mean). Both go through {@link levelForRange}, so a window older
 * than a level's retention horizon reads the next level that still holds it
 * rather than a dropped one that would answer "no data". `now` is an
 * argument (the pure-builder rule).
 */
export function pointStatsLevels(from: Date, to: Date, now: Date): { level: AggregateLevel; lastLevel: AggregateLevel } {
  const windowMinutes = (to.getTime() - from.getTime()) / 60_000;
  return {
    level: levelForRange({ start: from, granularity: granularityFor(windowMinutes), now }).level,
    lastLevel: levelForRange({ start: from, granularity: "1m", now }).level,
  };
}

/**
 * `F4.291` PR 3 review — what `get_point_stats` reads for an asked `[from, to)`.
 *
 * **The rollups bucket in UTC** (`time_bucket('1 hour' | '1 day', time)`), and
 * an asked window need not be aligned to them: an IST week starts and ends at
 * 18:30Z. Filtering coarse buckets by their start only (`bucket >= from AND
 * bucket < to`) counts the whole last bucket, past `to`, and drops the first
 * one, which holds samples inside the window. So the statistics read:
 *
 * - `[wholeFrom, wholeTo)` at `level`: the whole `level` buckets inside the
 *   covered period, and
 * - the rest of `[coveredFrom, coveredTo)` at `edgeLevel` (the `last` level,
 *   `1m` unless the window is past its retention horizon): the two partial
 *   ends, whole `edgeLevel` buckets.
 *
 * `[coveredFrom, coveredTo)` is the whole `edgeLevel` buckets inside the
 * asked window: the period every statistic AND `last` cover, which the answer
 * names. With `1m` it differs from the asked window only by the seconds of an
 * unaligned end (a `lastDays` window ends at the turn's clock). An empty
 * window (shorter than one `edgeLevel` bucket) answers `coveredTo ===
 * coveredFrom`, and `wholeTo === wholeFrom` when no whole `level` bucket fits.
 *
 * `edgeLevel` is never coarser than `level`: both come from
 * {@link levelForRange} on the same start, and only `1m` has a horizon.
 */
export interface PointStatsWindow {
  readonly level: AggregateLevel;
  readonly edgeLevel: AggregateLevel;
  readonly coveredFrom: Date;
  readonly coveredTo: Date;
  readonly wholeFrom: Date;
  readonly wholeTo: Date;
}

/** The first bucket start at or after `instant` (the ceiling of {@link floorToBucket}). */
function ceilToBucket(instant: Date, level: AggregateLevel): Date {
  const floor = floorToBucket(instant, level);
  return floor.getTime() === instant.getTime() ? floor : new Date(floor.getTime() + bucketSeconds(level) * 1_000);
}

/** The later of two instants. */
function later(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export function pointStatsWindow(from: Date, to: Date, now: Date): PointStatsWindow {
  const { level, lastLevel: edgeLevel } = pointStatsLevels(from, to, now);
  const coveredFrom = ceilToBucket(from, edgeLevel);
  const coveredTo = later(coveredFrom, floorToBucket(to, edgeLevel));
  const wholeFrom = ceilToBucket(coveredFrom, level);
  const wholeTo = later(wholeFrom, floorToBucket(coveredTo, level));
  return { level, edgeLevel, coveredFrom, coveredTo, wholeFrom, wholeTo };
}

/**
 * `F4.291` PR 3 — min / mean / max / sample count per asset over the covered
 * period of a {@link PointStatsWindow}, one row per asset with a row in it
 * (`GROUP BY asset_id`). The same {@link AGG_EXPR} table as
 * {@link scalarSql}, so the mean is `avgExpr()` in its zero guard and the
 * weighting holds across the folded buckets.
 *
 * Two branches under one `UNION ALL`, folded together (every rollup carries
 * `sum_value`, `sample_count`, `min_value`, `max_value`): the whole `level`
 * buckets in `[wholeFrom, wholeTo)`, and the `edgeLevel` buckets in
 * `[coveredFrom, coveredTo)` outside them. No bucket that reaches past the
 * covered period is read, and none inside it is dropped (review finding:
 * `bucket >= from AND bucket < to` on a UTC hour or day did both). When the
 * two levels are the same, the second branch's predicate admits nothing.
 *
 * **`asset_id = ANY(ids)` is the containment**, in both branches:
 * `telemetry.*` has no Row Level Security, so an asset the caller may not
 * read is kept out by the caller passing only placed ids and by this
 * predicate reading only them.
 *
 * Parameters: ids, key, coveredFrom, coveredTo, wholeFrom, wholeTo.
 */
export function groupedScalarSql(
  level: AggregateLevel,
  edgeLevel: AggregateLevel,
  [idsIndex, keyIndex, coveredFromIndex, coveredToIndex, wholeFromIndex, wholeToIndex] = [1, 2, 3, 4, 5, 6],
): string {
  const ids = `${placeholder(idsIndex)}::uuid[]`;
  const key = placeholder(keyIndex);
  const wholeFrom = `${placeholder(wholeFromIndex)}::timestamptz`;
  const wholeTo = `${placeholder(wholeToIndex)}::timestamptz`;
  return `
    SELECT
      asset_id,
      ${AGG_EXPR.avg} AS average,
      ${AGG_EXPR.min} AS min,
      ${AGG_EXPR.max} AS max,
      coalesce(sum(sample_count), 0)::bigint AS sample_count
    FROM (
      SELECT asset_id, sum_value, sample_count, min_value, max_value
      FROM ${relationFor(level)}
      WHERE asset_id = ANY(${ids}) AND point_key = ${key}
        AND bucket >= ${wholeFrom} AND bucket < ${wholeTo}
      UNION ALL
      SELECT asset_id, sum_value, sample_count, min_value, max_value
      FROM ${relationFor(edgeLevel)}
      WHERE asset_id = ANY(${ids}) AND point_key = ${key}
        AND bucket >= ${placeholder(coveredFromIndex)}::timestamptz AND bucket < ${placeholder(coveredToIndex)}::timestamptz
        AND (bucket < ${wholeFrom} OR bucket >= ${wholeTo})
    ) s
    GROUP BY asset_id
  `;
}

/**
 * `F4.291` PR 3 — per asked asset, the newest bucket in `[from, to)` that
 * holds a counted sample: its mean (`last`) and its start (`last_at`). The
 * service passes the covered period of a {@link PointStatsWindow} at its
 * `edgeLevel`, so `last` and the statistics cover the same buckets.
 *
 * One `LATERAL … ORDER BY bucket DESC LIMIT 1` probe per asset rather than a
 * `DISTINCT ON` over the window, for the reason `latestPointValues` records:
 * the probe's cost is bounded by the asset count, a `DISTINCT ON` sorts every
 * row in the window. The `GROUP BY bucket` is degenerate (one source row per
 * bucket at the level) and stays so the mean is the shared `AGG_EXPR.avg`, as
 * {@link bucketSql} explains; `HAVING sum(sample_count) > 0` passes over a
 * bucket whose samples were all null instead of dividing by zero or answering
 * a null `last` when an earlier bucket has one. An asset with no such bucket
 * has no row (`CROSS JOIN`).
 */
export function lastBucketSql(level: AggregateLevel, idsIndex = 1, keyIndex = 2, fromIndex = 3, toIndex = 4): string {
  return `
    SELECT a.asset_id, l.bucket AS last_at, l.last
    FROM unnest(${placeholder(idsIndex)}::uuid[]) AS a(asset_id)
    CROSS JOIN LATERAL (
      SELECT p.bucket, ${AGG_EXPR.avg} AS last
      FROM ${relationFor(level)} p
      WHERE p.asset_id = a.asset_id AND p.point_key = ${placeholder(keyIndex)}
        AND p.bucket >= ${placeholder(fromIndex)}::timestamptz AND p.bucket < ${placeholder(toIndex)}::timestamptz
      GROUP BY p.bucket
      HAVING sum(sample_count) > 0
      ORDER BY p.bucket DESC
      LIMIT 1
    ) l
  `;
}

/**
 * Fills the gaps a sparse rollup leaves, so every bucket in the window is
 * present — with `null` where there were no samples.
 *
 * **The query returns only materialized rows, so an outage arrives as an ABSENT
 * bucket, not a `null` one** (browser verification). That difference is not
 * cosmetic. `buildChartOption` sets no `connectNulls`, so ECharts breaks the
 * line at an explicit `null` and draws a straight segment across a missing
 * point — an hour with no telemetry would render as a clean interpolation
 * between its neighbours. A chart that invents a line through an outage is the
 * same class of defect as a tile showing `0` for a dead sensor.
 *
 * Done here rather than with `time_bucket_gapfill`: this is pure arithmetic,
 * testable with no database, and it needs no Timescale-specific SQL in a query
 * that already composes three CTEs. The row count it produces is exactly
 * {@link expectedBucketCount}, which is what makes that bound meaningful in both
 * directions rather than only as a ceiling.
 *
 * Buckets are aligned to the epoch by `time_bucket`, so the first filled bucket
 * is the first aligned instant at or after `from` — the same one the `bucket >=
 * $from` predicate admits.
 */
export function fillBucketGaps(
  rows: readonly { t: string; v: number | null }[],
  from: Date,
  to: Date,
  seconds: number,
): { t: string; v: number | null }[] {
  const stepMs = seconds * 1_000;
  const byStart = new Map(rows.map((row) => [new Date(row.t).getTime(), row.v]));
  const first = Math.ceil(from.getTime() / stepMs) * stepMs;
  const filled: { t: string; v: number | null }[] = [];
  for (let at = first; at < to.getTime(); at += stepMs) {
    filled.push({ t: new Date(at).toISOString(), v: byStart.get(at) ?? null });
  }
  return filled;
}

/**
 * The most buckets THIS window can produce at THIS level.
 *
 * `MAX_BUCKETS` is the global worst case, taken at the finest rung. Checking a
 * coarse read against it leaves a hole (code review): if `point_values_1h` ever
 * became a 15-minute aggregate, a 30-day window would return 2,880 rows —
 * exactly at the global bound — and pass. The per-rung expectation fires.
 */
export function expectedBucketCount(windowMinutes: number, level: AggregateLevel): number {
  return Math.ceil(windowMinutes / (bucketSeconds(level) / 60));
}

/**
 * The start of the bucket an instant falls in — `time_bucket`'s own alignment,
 * in TypeScript.
 *
 * **Extracted here by `F4.72` so there is exactly one copy of it.** It was
 * inline in `alignedWindow` (`apps/api/src/asset-health/health-rollup.service.ts`),
 * and `F4.72` needed the same arithmetic on the read side. Two copies of a
 * boundary rule is how a writer and a reader come to disagree about which
 * bucket is the newest one, which is precisely the defect `F4.72`'s review
 * found: the sweep never writes the in-flight bucket, the read admitted it, and
 * so a fully covered window was unreachable by one.
 *
 * `bucketSeconds` is the same width table the roll-up and the ladder use, so
 * this cannot drift from either. Pure, and `now` is an argument — the rule
 * `tests/repo-invariants.test.ts` enforces for every builder in this file.
 */
export function floorToBucket(instant: Date, level: AggregateLevel): Date {
  const widthMs = bucketSeconds(level) * 1_000;
  return new Date(Math.floor(instant.getTime() / widthMs) * widthMs);
}

/**
 * Refuses an over-long bucket array rather than truncating it.
 *
 * Reachable only if the ladder and a relation disagree — a continuous
 * aggregate's bucket width changed without `BUCKET_SECONDS` following. In that
 * state a chart would silently plot a prefix of its window, which looks exactly
 * like a sensor that stopped reporting.
 */
export function assertBucketCount(rowCount: number, expected = MAX_BUCKETS): void {
  const bound = Math.min(expected, MAX_BUCKETS);
  if (rowCount > bound) {
    throw new Error(
      `point aggregate returned ${rowCount} buckets, past the ${bound} this window and level ` +
        "admit. The chosen level's bucket width and BUCKET_SECONDS disagree; refusing rather " +
        "than plotting a truncated window, which is indistinguishable from a dead sensor.",
    );
  }
}
