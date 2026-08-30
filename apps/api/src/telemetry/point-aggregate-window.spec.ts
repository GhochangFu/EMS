import type { PointAggregateFunction } from "@bms/shared";

import {
  MAX_BUCKETS,
  aggregateExpression,
  assertBucketCount,
  bucketSql,
  expectedBucketCount,
  fillBucketGaps,
  granularityFor,
  levelFor,
  scalarSql,
  windowBounds,
} from "./point-aggregate-window";
import { avgExpr, bucketSeconds, levelForRange, retentionDays } from "./point-aggregates";

/**
 * `F3.35` Stage A — the pure half of the general aggregate read (ADR 0048
 * decision 3). Assertions live here; `point-aggregate-window.test.ts` is the
 * vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const FUNCTIONS: PointAggregateFunction[] = ["sum", "avg", "min", "max"];

/** 2026-08-30T12:00:00Z — pinned, because every window below is relative to it. */
const NOW = new Date("2026-08-30T12:00:00.000Z");

/**
 * The three rungs and both boundaries.
 *
 * The boundaries are asserted on both sides because a window of 2,881 minutes
 * lands on `1h` where 2,880 lands on `1m` — a granularity cliff the author
 * cannot see in the builder. It is deterministic and a function of their own
 * configured window, which is why the chart footer shows the granularity.
 */
export function assertTheLadderPicksAGranularityPerRung(): void {
  assert(granularityFor(1) === "1m", "one minute reads the finest level");
  assert(granularityFor(1_440) === "1m", "a day reads 1m");
  assert(granularityFor(2_880) === "1m", "48 hours is the last window that reads 1m");
  assert(granularityFor(2_881) === "1h", "one minute past 48 hours steps to 1h");
  assert(granularityFor(43_200) === "1h", "30 days is the last window that reads 1h");
  assert(granularityFor(43_201) === "1d", "one minute past 30 days steps to 1d");
  assert(granularityFor(525_600) === "1d", "a year reads 1d");
}

/**
 * Past the last rung the schema should already have refused the request, so this
 * throws rather than defaulting to `1d`.
 *
 * A default would be the dangerous direction: it would answer a window nothing
 * validated, from a relation nothing checked the retention of.
 */
export function assertAWindowPastTheLastRungThrows(): void {
  let threw = false;
  try {
    granularityFor(525_601);
  } catch {
    threw = true;
  }
  assert(threw, "a window past the coarsest rung must throw, not default to 1d");
}

/**
 * **The bucket bound is derived, not declared.**
 *
 * Recomputing it from the ladder here means that moving a boundary or adding a
 * rung either keeps the bound or fails this assertion. A literal `2_880` in the
 * module and a literal `2_880` in the test would agree with each other forever
 * while disagreeing with the ladder.
 */
export function assertMaxBucketsIsDerivedFromTheLadder(): void {
  const rungs: { windowMinutes: number; expected: number }[] = [
    { windowMinutes: 2_880, expected: 2_880 }, // 1m buckets
    { windowMinutes: 43_200, expected: 720 }, // 1h buckets
    { windowMinutes: 525_600, expected: 365 }, // 1d buckets
  ];
  for (const rung of rungs) {
    const minutesPerBucket = bucketSeconds(granularityFor(rung.windowMinutes)) / 60;
    const buckets = rung.windowMinutes / minutesPerBucket;
    assert(
      buckets === rung.expected,
      `a ${rung.windowMinutes}-minute window yields ${buckets} buckets, expected ${rung.expected}`,
    );
    assert(
      buckets <= MAX_BUCKETS,
      `rung ${rung.windowMinutes} yields ${buckets} buckets, past MAX_BUCKETS ${MAX_BUCKETS}`,
    );
  }
  assert(MAX_BUCKETS === 2_880, `MAX_BUCKETS derived to ${MAX_BUCKETS}, expected 2880`);
}

/** The over-long guard refuses rather than truncating. */
export function assertTheBucketGuardRefusesPastTheBound(): void {
  assertBucketCount(MAX_BUCKETS);
  let threw = false;
  try {
    assertBucketCount(MAX_BUCKETS + 1);
  } catch {
    threw = true;
  }
  assert(threw, "one bucket past the bound must throw — a truncated chart looks like a dead sensor");
}

/**
 * **The guard is checked per rung, not only against the global worst case**
 * (code review).
 *
 * `MAX_BUCKETS` is 2,880, taken at the finest rung. If `point_values_1h` ever
 * became a 15-minute aggregate, a 30-day window would return exactly 2,880 rows
 * and pass the global bound — the one state the guard exists to catch, sailing
 * through it. The per-rung expectation is what fires.
 */
export function assertTheBucketGuardIsCheckedPerRung(): void {
  assert(expectedBucketCount(1_440, "1m") === 1_440, "a day of minute buckets is 1,440");
  assert(expectedBucketCount(43_200, "1h") === 720, "30 days of hourly buckets is 720");
  assert(expectedBucketCount(525_600, "1d") === 365, "a year of daily buckets is 365");

  // The scenario itself: a coarse read handing back the global worst case.
  assertBucketCount(720, expectedBucketCount(43_200, "1h"));
  let threw = false;
  try {
    assertBucketCount(MAX_BUCKETS, expectedBucketCount(43_200, "1h"));
  } catch {
    threw = true;
  }
  assert(
    threw,
    "2,880 rows from a 30-day hourly read must be refused; it sits exactly at the GLOBAL bound, " +
      "which is why the global bound alone cannot catch a widened continuous aggregate",
  );
}

/**
 * The compare window abuts the current one exactly.
 *
 * A gap would compare against a period the operator did not ask about; an
 * overlap would count the same samples on both sides of a percentage.
 */
export function assertTheCompareWindowAbutsTheCurrentOne(): void {
  const window = windowBounds(NOW, 1_440, true);
  assert(window.to.getTime() === NOW.getTime(), "the window ends now");
  assert(
    window.to.getTime() - window.from.getTime() === 1_440 * 60_000,
    "the window is exactly as long as it was asked to be",
  );
  assert(
    window.compareTo?.getTime() === window.from.getTime(),
    "the compare window must end exactly where the current one begins — no gap, no overlap",
  );
  assert(
    (window.compareTo?.getTime() ?? 0) - (window.compareFrom?.getTime() ?? 0) === 1_440 * 60_000,
    "the compare window must be the same length as the current one",
  );

  const plain = windowBounds(NOW, 1_440, false);
  assert(
    plain.compareFrom === null && plain.compareTo === null,
    "without a compare there is no compare window",
  );
}

/**
 * `readStart` is the compare-shifted start, and it is what the retention guard
 * must be given.
 *
 * Passing `from` instead would understate the request's reach by one whole
 * window — the direction that admits a level whose data has been dropped.
 */
export function assertReadStartCarriesTheCompareReach(): void {
  const window = windowBounds(NOW, 1_440, true);
  assert(
    window.readStart.getTime() === window.compareFrom?.getTime(),
    "with a compare, readStart is the compare window's start",
  );
  const plain = windowBounds(NOW, 1_440, false);
  assert(
    plain.readStart.getTime() === plain.from.getTime(),
    "without a compare, readStart is the window's own start",
  );
}

/**
 * **The reason `LevelChoice.coarsened` is not surfaced.**
 *
 * Every rung, at its own maximum window, with the compare doubling its reach,
 * still resolves to the granularity the ladder asked for. So escalation is
 * unreachable and a flag reporting it would be dead — exactly the dead flag its
 * own docblock complains about.
 *
 * This is arithmetic against the real `RETENTION_DAYS`, so shortening a horizon
 * fails here rather than silently widening a chart's buckets.
 */
export function assertEscalationIsUnreachableAtEveryRung(): void {
  for (const windowMinutes of [2_880, 43_200, 525_600]) {
    const granularity = granularityFor(windowMinutes);
    const window = windowBounds(NOW, windowMinutes, true);
    const choice = levelForRange({ start: window.readStart, granularity, now: NOW });
    assert(
      choice.coarsened === false,
      `a ${windowMinutes}-minute window with a compare escalated from ${granularity} to ` +
        `${choice.level}; the ladder no longer bounds this endpoint and the granularity must be surfaced`,
    );
    assert(
      levelFor(window, windowMinutes, NOW) === granularity,
      `levelFor disagreed with the ladder at ${windowMinutes} minutes`,
    );
  }
  assert(
    retentionDays("1h") === null && retentionDays("1d") === null,
    "the two coarse levels must stay free of a horizon (ADR 0023 decision 7)",
  );
}

/**
 * **The reuse assertion — stronger than the negative one below it.**
 *
 * It proves the shared expression is used, not merely that a wrong one is
 * absent. A second correct-looking copy of the mean would pass every negative
 * check and still drift the day `avgExpr` changes.
 */
export function assertBothQueriesReuseAvgExpr(): void {
  assert(
    bucketSql("avg", "1m").includes(avgExpr()),
    "the bucket query must reuse avgExpr(), not restate the division",
  );
  assert(
    scalarSql("1m").includes(avgExpr()),
    "the scalar query must reuse avgExpr(), not restate the division",
  );
  assert(
    bucketSql("avg", "1m").includes("sum(sample_count) > 0"),
    "the zero-denominator guard must wrap avgExpr(), because sample_count is a count of non-nulls",
  );
}

/**
 * The form that still typechecks and is still wrong.
 *
 * `avg(avg_value)` cannot be written any more — ADR 0023 never created the
 * column. `avg(sum_value)` can, and it averages bucket totals, which is wrong by
 * a factor of the samples per bucket. No query this module emits may call `avg()`
 * at all.
 */
export function assertNoQueryCallsSqlAvg(): void {
  for (const fn of FUNCTIONS) {
    const sql = bucketSql(fn, "1m");
    assert(
      !/\bavg\s*\(/i.test(sql),
      `bucketSql("${fn}") calls SQL avg(); the weighted division is the only correct mean`,
    );
  }
  assert(
    !/\bavg\s*\(/i.test(scalarSql("1h")),
    "scalarSql calls SQL avg(); the weighted division is the only correct mean",
  );
}

/**
 * The only identifier interpolated into either query is a relation from the
 * closed set. The function name is a `Record` key and never reaches SQL as a
 * string — the guarantee ADR 0048's Consequences call the security-relevant part.
 */
export function assertOnlyTheRelationIsInterpolated(): void {
  for (const fn of FUNCTIONS) {
    const sql = bucketSql(fn, "5m");
    assert(
      sql.includes("telemetry.point_values_5m"),
      `bucketSql("${fn}") must read the relation the level names`,
    );
    // **A positive assertion, because the negatives it replaced could not fail**
    // (code review). `!sql.includes('"sum"') && !/\bsum\s+AS\b/` passed happily
    // on the exact leak it was named for: the direct interpolation
    // `SELECT bucket AS t, ${fn}(sum_value) AS v` emits `sum(sum_value) AS v`,
    // which has no quoted identifier and no `sum` followed by `AS`. Requiring
    // the fragment to BE the closed-`Record` value is the check that holds:
    // any other expression, interpolated or not, fails it.
    const expression = aggregateExpression(fn);
    assert(
      expression !== undefined && sql.includes(expression),
      `bucketSql("${fn}") did not emit the expression the closed Record holds for it`,
    );
  }
  assert(
    aggregateExpression("median" as PointAggregateFunction) === undefined,
    "an unknown function must resolve to nothing rather than falling through to a prototype member",
  );
  let threw = false;
  try {
    bucketSql("median" as PointAggregateFunction, "1m");
  } catch {
    threw = true;
  }
  assert(threw, "bucketSql must throw on an unknown function rather than emitting broken SQL");
}

/**
 * The bucket query's shape. The degenerate `GROUP BY` is asserted so that
 * "simplifying" it away fails a test rather than quietly introducing a second
 * copy of the mean — see `bucketSql`'s docblock.
 */
export function assertTheBucketQueryGroupsAndOrders(): void {
  const sql = bucketSql("sum", "1m");
  assert(sql.includes("GROUP BY bucket"), "the bucket query must group by bucket");
  assert(sql.includes("ORDER BY bucket ASC"), "the bucket query must return buckets in time order");
  assert(
    sql.includes(`LIMIT ${MAX_BUCKETS + 1}`),
    "the bucket query must fetch one past the bound so the guard can tell 'at' from 'past'",
  );
}

/**
 * The peak's tie-break. Two buckets sharing the highest value must resolve to
 * the earlier one, every time — without `bucket ASC` the tile flickers between
 * reads and any test on it is flaky.
 */
export function assertThePeakHasAStableTieBreak(): void {
  const sql = scalarSql("1m");
  assert(
    sql.includes("ORDER BY p.max_value DESC NULLS LAST, p.bucket ASC"),
    "the peak must break ties on the earlier bucket, deterministically",
  );
}

/**
 * The parameter index is the one caller-supplied value that reaches the SQL
 * text, because the service emits the same fragment twice — once for the current
 * window and once for the compare window — inside **one statement**, so the two
 * share a transaction snapshot. It is a number, and it is checked.
 */
export function assertParameterIndicesAreChecked(): void {
  const shifted = scalarSql("1m", 5, 6);
  assert(shifted.includes("$5::timestamptz"), "a shifted fragment must use the index it was given");
  assert(shifted.includes("$6::timestamptz"), "both ends must shift together");
  assert(
    shifted.includes("asset_id = $1") && shifted.includes("point_key = $2"),
    "the point's own parameters must not move",
  );
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    let threw = false;
    try {
      scalarSql("1m", bad, 4);
    } catch {
      threw = true;
    }
    assert(threw, `a parameter index of ${bad} must be refused, not interpolated`);
  }
}

/**
 * **A gap is a `null` bucket, not an absent one** (browser verification — the
 * live endpoint returned 4 rows where the ladder promises 72, because the hours
 * with no samples were simply missing).
 *
 * The difference decides what an operator sees. `buildChartOption` sets no
 * `connectNulls`, so ECharts breaks the line at an explicit `null` and draws a
 * straight segment across a missing point — an outage would render as a clean
 * interpolation between its neighbours. A chart that invents a line through an
 * outage is the same defect as a tile showing `0` for a dead sensor.
 */
export function assertGapsAreFilledWithNulls(): void {
  const from = new Date("2026-08-30T04:00:00.000Z");
  const to = new Date("2026-08-30T08:00:00.000Z");
  // 05:00 is deliberately absent, which is exactly what the live rollup did.
  const sparse = [
    { t: "2026-08-30T04:00:00.000Z", v: 10 },
    { t: "2026-08-30T06:00:00.000Z", v: 12 },
    { t: "2026-08-30T07:00:00.000Z", v: 13 },
  ];

  const filled = fillBucketGaps(sparse, from, to, 3_600);
  assert(
    filled.length === 4,
    `a four-hour window at hourly buckets must yield 4 rows, got ${filled.length}`,
  );
  assert(filled[1]?.t === "2026-08-30T05:00:00.000Z", "the missing hour must be present");
  assert(
    filled[1]?.v === null,
    "the missing hour must carry a null value, so ECharts breaks the line rather than " +
      "interpolating straight through an outage",
  );
  assert(
    filled[0]?.v === 10 && filled[2]?.v === 12 && filled[3]?.v === 13,
    "the values that were there must survive, in time order",
  );
}

/**
 * The filled count is exactly what {@link expectedBucketCount} predicts, at
 * every rung.
 *
 * That is what makes the bound meaningful in **both** directions. Before the
 * gap fill it was only a ceiling: a window returning four rows out of seventy-two
 * passed it, and the browser check was the first thing to notice.
 */
export function assertTheFilledCountMatchesTheLadder(): void {
  const now = new Date("2026-08-30T12:00:00.000Z");
  for (const windowMinutes of [1_440, 4_320, 525_600]) {
    const level = granularityFor(windowMinutes);
    const window = windowBounds(now, windowMinutes, false);
    const filled = fillBucketGaps([], window.from, window.to, bucketSeconds(level));
    assert(
      filled.length === expectedBucketCount(windowMinutes, level),
      `a ${windowMinutes}-minute window at ${level} filled to ${filled.length} rows, ` +
        `expected ${expectedBucketCount(windowMinutes, level)}`,
    );
    // And the guard accepts exactly that many, so the two agree by construction.
    assertBucketCount(filled.length, expectedBucketCount(windowMinutes, level));
  }
}
