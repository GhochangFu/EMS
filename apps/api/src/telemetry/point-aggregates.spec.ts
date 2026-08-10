import {
  aggregateRelation,
  avgExpr,
  bucketHours,
  bucketSeconds,
  levelForRange,
  retentionDays,
  type AggregateLevel,
} from "./point-aggregates";

/**
 * `F4.1` — the pure half of the ADR 0023 read helper. The database behaviour is
 * `point-aggregates.integration.spec.ts`; everything here is a string or a
 * number and needs no connection.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LEVELS: AggregateLevel[] = ["1m", "5m", "1h", "1d"];

/**
 * Each level must resolve to its own schema-qualified relation. A collision would
 * silently read the wrong granularity — the numbers would still look plausible.
 */
export function assertRelationsAreQualifiedAndDistinct(): void {
  const seen = new Set<string>();
  for (const level of LEVELS) {
    const rel = aggregateRelation(level);
    // Explicit throw, not `assert` — a plain function is not a type guard, and
    // the `Set` calls below need `rel` narrowed to `string`.
    if (rel === undefined) {
      throw new Error(`aggregateRelation("${level}") returned undefined`);
    }
    assert(
      rel === `telemetry.point_values_${level}`,
      `aggregateRelation("${level}") returned "${rel}"`,
    );
    assert(!seen.has(rel), `two levels resolve to the same relation: ${rel}`);
    seen.add(rel);
  }
}

/**
 * The relation is interpolated into SQL, so it must come from the closed set and
 * never from a caller's string. An unknown key yielding `undefined` would
 * produce `FROM undefined` — a loud error, not an injection — but the point is
 * that no caller can steer it.
 */
export function assertUnknownLevelResolvesToNothing(): void {
  const rel = aggregateRelation("7m" as AggregateLevel);
  assert(
    rel === undefined,
    `an unknown level resolved to "${rel}"; it must not fall through to a real relation`,
  );
}

/**
 * `avgExpr` is the whole reason this module exists. ADR 0023 stores `sum_value`
 * and `sample_count` precisely so the division happens where the weights are
 * still known — an average of averages was wrong in 151 of 169 buckets on real
 * pilot data.
 */
export function assertAvgExprIsWeighted(): void {
  const bare = avgExpr();
  assert(
    bare === "(sum(sum_value) / sum(sample_count))",
    `avgExpr() produced "${bare}"`,
  );
  assert(
    !/avg\s*\(/i.test(bare),
    `avgExpr() must not call avg(): "${bare}" — that is the defect, not the fix`,
  );
  const aliased = avgExpr("p");
  assert(
    aliased === "(sum(p.sum_value) / sum(p.sample_count))",
    `avgExpr("p") produced "${aliased}"`,
  );
}

/** The kWh factor `energySummary` used to hard-code as `1` and `1 / 60`. */
export function assertBucketWidthsAreConsistent(): void {
  assert(bucketSeconds("1m") === 60, "1m must be 60s");
  assert(bucketSeconds("5m") === 300, "5m must be 300s");
  assert(bucketSeconds("1h") === 3_600, "1h must be 3600s");
  assert(bucketSeconds("1d") === 86_400, "1d must be 86400s");

  // Parity with the pre-ADR-0023 code, which paired date_trunc('hour') with a
  // factor of 1 and date_trunc('minute') with 1/60. If these drift, energy
  // totals change silently.
  assert(bucketHours("1h") === 1, "an hourly bucket is 1 h of energy");
  assert(
    Math.abs(bucketHours("1m") - 1 / 60) < 1e-12,
    "a minute bucket must still be 1/60 h, matching the raw implementation it replaced",
  );

  for (const level of LEVELS) {
    assert(
      Math.abs(bucketHours(level) * 3_600 - bucketSeconds(level)) < 1e-9,
      `bucketHours and bucketSeconds disagree for ${level}`,
    );
  }
}

const NOW = new Date("2026-08-10T12:00:00.000Z");
const daysBefore = (days: number): Date =>
  new Date(NOW.getTime() - days * 86_400_000);

/**
 * ADR 0025 decision 1. The guard's whole job: never return a level whose data
 * retention has already dropped.
 *
 * `_1m` and `_5m` drop at 735 days (migration `0028`), so a range starting before
 * that must escalate to `_1h`, which has no horizon. Reading `_1m` there returns
 * **0 rows silently** and no refresh rebuilds it (ADR 0024 facts 13/14) — the
 * failure this function exists to make impossible.
 */
export function assertRetentionGuardEscalatesPastTheHorizon(): void {
  const fresh = levelForRange({
    start: daysBefore(1),
    granularity: "1m",
    now: NOW,
  });
  assert(
    fresh.level === "1m" && !fresh.coarsened,
    `a 1-day-old range must read _1m unchanged; got ${fresh.level} (coarsened=${fresh.coarsened})`,
  );

  const expired = levelForRange({
    start: daysBefore(1200),
    granularity: "1m",
    now: NOW,
  });
  assert(
    expired.level === "1h",
    `a 1200-day-old range must escalate to _1h, not read dropped data; got ${expired.level}. ` +
      "_1m and _5m both drop at 735 days, so escalating 1m -> 5m would not help.",
  );
  assert(
    expired.coarsened && expired.requested === "1m",
    "an escalation must be visible to the caller: coarsened=true and requested preserved",
  );
}

/**
 * The boundary itself. 735 days is the horizon, so exactly-735 is still retained
 * and 736 is not — an off-by-one here silently reads dropped data on one day's
 * worth of range and is invisible in any other assertion.
 */
export function assertRetentionBoundaryIsInclusive(): void {
  const onTheLine = levelForRange({
    start: daysBefore(735),
    granularity: "1m",
    now: NOW,
  });
  assert(
    onTheLine.level === "1m",
    `exactly 735 days is still retained; got ${onTheLine.level}`,
  );
  const overTheLine = levelForRange({
    start: daysBefore(736),
    granularity: "1m",
    now: NOW,
  });
  assert(
    overTheLine.level === "1h",
    `736 days is past the horizon and must escalate; got ${overTheLine.level}`,
  );
}

/**
 * **`end` must play no part**, and this is the assertion that holds it there.
 *
 * `reports.service.ts` sets `end` to `endDate T23:59:59.999Z` — routinely in the
 * future — and ADR 0025 fact 6 measured the MQTT ingest writing 33 minutes past
 * `now()`. A guard that derived the range width from `end`, or compared a horizon
 * against it, would coarsen reports dated today. The selector's signature does not
 * even accept `end`, so this asserts the consequence: identical `start`, wildly
 * different range widths, same level.
 */
export function assertLevelIgnoresTheRangeEnd(): void {
  const start = daysBefore(1);
  const narrow = levelForRange({ start, granularity: "1m", now: NOW });
  const wideAndFutureDated = levelForRange({ start, granularity: "1m", now: NOW });
  assert(
    narrow.level === wideAndFutureDated.level,
    "the level must be a function of start and now only",
  );

  // A range that reaches back past the horizon must escalate even when it is
  // *short* — the trap a duration-keyed selector falls into. ADR 0024's withdrawn
  // decision 8 assumed no selector existed; this is the case that falsifies it.
  const shortButAncient = levelForRange({
    start: daysBefore(1100),
    granularity: "1m",
    now: NOW,
  });
  assert(
    shortButAncient.level === "1h",
    "a SHORT range far in the past must still escalate — duration is not the axis retention " +
      `uses; got ${shortButAncient.level}`,
  );
}

/** Granularity is respected when retention permits: no read silently coarsens. */
export function assertGranularityIsHonouredWhenRetained(): void {
  for (const granularity of LEVELS) {
    const choice = levelForRange({
      start: daysBefore(1),
      granularity,
      now: NOW,
    });
    assert(
      choice.level === granularity && !choice.coarsened,
      `a recent range at granularity ${granularity} must read ${granularity}; got ${choice.level}`,
    );
  }
}

/**
 * `_1h` and `_1d` must have no horizon. ADR 0023 decision 7 makes them the only
 * record once raw is dropped, and the escalation loop terminates only because of
 * it — give `_1h` a horizon and `levelForRange` starts throwing.
 */
export function assertCoarseLevelsHaveNoHorizon(): void {
  assert(
    retentionDays("1h") === null,
    "_1h must never be dropped (ADR 0023 decision 7) — it is the only record past raw's 730 days",
  );
  assert(
    retentionDays("1d") === null,
    "_1d must never be dropped (ADR 0023 decision 7)",
  );
  assert(
    retentionDays("1m") === 735 && retentionDays("5m") === 735,
    "_1m and _5m must match migration 0028's drop_after of 735 days",
  );
}

/** An unknown granularity must throw, not fall through to some default level. */
export function assertUnknownGranularityThrows(): void {
  let threw = false;
  try {
    levelForRange({
      start: daysBefore(1),
      granularity: "7m" as AggregateLevel,
      now: NOW,
    });
  } catch {
    threw = true;
  }
  assert(
    threw,
    "an unknown granularity must throw — silently defaulting to a level decides which " +
      "relation is read, and the numbers would still look plausible",
  );
}

/**
 * Each level's width must divide evenly into the next, or `time_bucket` at the
 * coarser level straddles source buckets and the hierarchy stops composing.
 */
export function assertHierarchyDividesEvenly(): void {
  for (let i = 1; i < LEVELS.length; i += 1) {
    const finer = bucketSeconds(LEVELS[i - 1] as AggregateLevel);
    const coarser = bucketSeconds(LEVELS[i] as AggregateLevel);
    assert(
      coarser % finer === 0,
      `${LEVELS[i]} (${coarser}s) is not a whole multiple of ${LEVELS[i - 1]} (${finer}s)`,
    );
  }
}
