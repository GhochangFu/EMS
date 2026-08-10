import {
  aggregateRelation,
  avgExpr,
  bucketHours,
  bucketSeconds,
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
