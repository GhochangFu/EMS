import { PgDialect } from "drizzle-orm/pg-core";

import type { AggregateLevel } from "../telemetry/point-aggregates";
import { bucketSeconds } from "../telemetry/point-aggregates";
import { levelRollupSql, rawRollupSql } from "./health-rollup-sql";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * There is no existing spec anywhere in this repo that asserts on a drizzle
 * `SQL` object — checked before writing this helper (`PgDialect`,
 * `sqlToQuery`, `queryChunks` and `.toSQL()` all return no hits under
 * `apps/api/src` or the wider repo). `PgDialect().sqlToQuery` is the same
 * conversion drizzle's own `PgSession` runs before handing a query to `pg`,
 * so asserting against its `{ sql, params }` is asserting the actual text and
 * bind values the database will see, not a proxy for them.
 */
const dialect = new PgDialect();
function toQuery(built: ReturnType<typeof rawRollupSql>): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(built);
}

const ADJACENT: readonly [AggregateLevel, AggregateLevel][] = [
  ["1m", "5m"],
  ["5m", "1h"],
  ["1h", "1d"],
];

const RANGE_FROM = new Date("2026-08-01T00:00:00.000Z");
const RANGE_TO = new Date("2026-08-01T01:00:00.000Z");

/** Thing 1: `JOIN bms.assets a` is present and is the tenant containment. */
function testRawRollupJoinsAssetsForTenantContainment(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(
    /JOIN\s+bms\.assets\s+a\s+ON\s+a\.id\s*=\s*pv\.asset_id/.test(sql),
    `expected a tenant-containment JOIN on bms.assets, got:\n${sql}`,
  );
}

/** Thing 2: the NOT EXISTS wraps an ELSE-less CASE — no ELSE anywhere in the statement. */
function testRawRollupHasNoElseBranch(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(/NOT EXISTS/.test(sql), "expected a NOT EXISTS wrapping the fires() predicate");
  assert(/CASE\s+r2\.operator/.test(sql), "expected the CASE to be built from firesCaseSql's operands");

  // **Scoped to the OPERATOR case, not to the whole statement.** This assertion
  // used to forbid `ELSE` anywhere, and that was too wide: the `E1.3` security
  // review added a second, legitimate `CASE WHEN m.rule_count = 0 THEN 0 ELSE
  // … END` around the count, and a blanket ban made the fix look like the defect.
  //
  // What must stay `ELSE`-less is the operator dispatch. With no `ELSE` it is
  // SQL NULL for a rule carrying a NULL `operator`/`threshold_value`, and
  // `WHERE … AND NULL` satisfies no `EXISTS` — so the rule neither fires nor
  // declares the sample in range. An `ELSE false` there reads as "did not fire"
  // and inflates the score (Amendment 1 decision 7).
  const operatorCase = sql.slice(sql.indexOf("CASE r2.operator"));
  const operatorCaseEnd = operatorCase.indexOf("END");
  assert(operatorCaseEnd > 0, "could not find the end of the operator CASE");
  assert(
    !/\bELSE\b/i.test(operatorCase.slice(0, operatorCaseEnd)),
    `the operator CASE must never carry an ELSE:\n${operatorCase.slice(0, operatorCaseEnd)}`,
  );
}

/**
 * Thing 0: the all-skipped bucket stores 0, not a fabricated perfect score.
 *
 * Without `CASE WHEN m.rule_count = 0 THEN 0`, a tag whose every matching rule
 * is unevaluatable gets `NOT EXISTS` true for every sample and stores
 * `in_range_count = sample_count` — a 1.0 ratio produced by rules that do
 * nothing, which both other CHECK constraints accept. Found by the `E1.3`
 * security and migration reviews and reproduced against Postgres before fixing.
 */
function testRawRollupWritesZeroWhenEveryRuleIsUnevaluatable(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(
    /CASE\s+WHEN\s+m\.rule_count\s*=\s*0\s+THEN\s+0\s+ELSE/i.test(sql),
    `expected the rule_count = 0 guard around in_range_count, got:\n${sql}`,
  );
}

/**
 * The level roll-up carries the same tenant join as the raw one.
 *
 * Both its source and its target are `telemetry.*`, which has no Row Level
 * Security, so without this join one organization's tenant transaction reads and
 * rewrites every other organization's rows — three times per tick. Missing until
 * the `E1.3` security review found it.
 */
function testLevelRollupJoinsAssetsForTenantContainment(): void {
  for (const [from, to] of [
    ["1m", "5m"],
    ["5m", "1h"],
    ["1h", "1d"],
  ] as const) {
    const { sql } = toQuery(levelRollupSql(from, to, RANGE_FROM, RANGE_TO));
    assert(
      /JOIN\s+bms\.assets\s+a\s+ON\s+a\.id\s*=\s*f\.asset_id/.test(sql),
      `${from} -> ${to} must join bms.assets for tenant containment, got:\n${sql}`,
    );
  }
}

/** Thing 3: an INNER JOIN matched — never a LEFT JOIN — is what excludes unruled tags. */
function testRawRollupInnerJoinsMatched(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(/JOIN\s+matched\s+m\s+ON/.test(sql), `expected an inner JOIN matched, got:\n${sql}`);
  assert(!/LEFT\s+JOIN\s+matched/i.test(sql), "matched must be an INNER JOIN, never a LEFT JOIN");
}

/** Thing 4: ON CONFLICT DO UPDATE, never DO NOTHING. */
function testRawRollupUpsertsRatherThanIgnoring(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(
    /ON CONFLICT \(bucket, asset_id, point_key\) DO UPDATE SET/.test(sql),
    `expected an ON CONFLICT ... DO UPDATE, got:\n${sql}`,
  );
  assert(!/DO NOTHING/i.test(sql), "a re-run must re-evaluate against the current rule set, never DO NOTHING");
}

/** Thing 5: the bucket width is derived from bucketSeconds("1m"), never a hand-written literal. */
function testRawRollupIntervalIsDerivedNotLiteral(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  const expectedSeconds = bucketSeconds("1m");
  assert(expectedSeconds === 60, `sanity: bucketSeconds("1m") should be 60, got ${expectedSeconds}`);
  assert(
    sql.includes(`'${expectedSeconds} seconds'::interval`),
    `expected the 1m bucket width derived from bucketSeconds, got:\n${sql}`,
  );
  assert(!/'1\s*minute'/i.test(sql), "must not hard-code a '1 minute' literal");
}

function testRawRollupWritesTheRightRelation(): void {
  const { sql } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(sql.includes("INSERT INTO telemetry.point_in_range_1m"), "must insert into point_in_range_1m");
  assert(sql.includes("FROM telemetry.point_values pv"), "must read raw telemetry.point_values");
}

/** The range bounds must be BOUND PARAMETERS, never literal text in the query. */
function testRawRollupBindsRangeAsParametersNotLiterals(): void {
  const { sql, params } = toQuery(rawRollupSql(RANGE_FROM, RANGE_TO));
  assert(
    !sql.includes(RANGE_FROM.toISOString()) && !sql.includes(RANGE_TO.toISOString()),
    `the range bounds must never be concatenated into the query text, got:\n${sql}`,
  );
  assert(
    params.some((p) => p instanceof Date && p.getTime() === RANGE_FROM.getTime()),
    `expected ${RANGE_FROM.toISOString()} among the bound params, got ${JSON.stringify(params)}`,
  );
  assert(
    params.some((p) => p instanceof Date && p.getTime() === RANGE_TO.getTime()),
    `expected ${RANGE_TO.toISOString()} among the bound params, got ${JSON.stringify(params)}`,
  );
  // Two `pv.time >=` / `pv.time <` placeholders, and nothing else needs one —
  // every other value in this statement is structural (`sql.raw`).
  assert(params.length === 2, `expected exactly 2 bound params, got ${params.length}: ${JSON.stringify(params)}`);
}

/** levelRollupSql: sum for counts, max for rule tallies — for every adjacent pair. */
function testLevelRollupUsesSumForCountsAndMaxForRuleTallies(): void {
  for (const [from, to] of ADJACENT) {
    const { sql } = toQuery(levelRollupSql(from, to, RANGE_FROM, RANGE_TO));
    assert(sql.includes("sum(f.in_range_count)"), `[${from}->${to}] expected sum(f.in_range_count):\n${sql}`);
    assert(sql.includes("sum(f.sample_count)"), `[${from}->${to}] expected sum(f.sample_count):\n${sql}`);
    assert(sql.includes("max(f.rule_count)"), `[${from}->${to}] expected max(f.rule_count):\n${sql}`);
    assert(
      sql.includes("max(f.skipped_rule_count)"),
      `[${from}->${to}] expected max(f.skipped_rule_count):\n${sql}`,
    );
    // The wrong-but-tempting shape: summing all four columns.
    assert(!sql.includes("sum(f.rule_count)"), `[${from}->${to}] rule_count must never be summed:\n${sql}`);
    assert(
      !sql.includes("sum(f.skipped_rule_count)"),
      `[${from}->${to}] skipped_rule_count must never be summed:\n${sql}`,
    );
  }
}

function testLevelRollupWritesTheCorrectRelationsAndInterval(): void {
  for (const [from, to] of ADJACENT) {
    const { sql, params } = toQuery(levelRollupSql(from, to, RANGE_FROM, RANGE_TO));
    assert(
      sql.includes(`INSERT INTO telemetry.point_in_range_${to}`),
      `[${from}->${to}] expected INSERT INTO point_in_range_${to}:\n${sql}`,
    );
    assert(
      sql.includes(`FROM telemetry.point_in_range_${from} f`),
      `[${from}->${to}] expected FROM point_in_range_${from}:\n${sql}`,
    );
    assert(
      sql.includes(`'${bucketSeconds(to)} seconds'::interval`),
      `[${from}->${to}] expected the TO level's own bucket width, got:\n${sql}`,
    );
    assert(
      sql.includes("ON CONFLICT (bucket, asset_id, point_key) DO UPDATE SET"),
      `[${from}->${to}] expected ON CONFLICT ... DO UPDATE:\n${sql}`,
    );
    assert(params.length === 2, `[${from}->${to}] expected exactly 2 bound params, got ${params.length}`);
  }
}

/** Non-adjacent and descending pairs must throw, never silently derive across a gap. */
function testLevelRollupRejectsNonAdjacentAndDescendingPairs(): void {
  const bad: [AggregateLevel, AggregateLevel][] = [
    ["1m", "1h"], // skips 5m
    ["1m", "1d"], // skips 5m and 1h
    ["5m", "1d"], // skips 1h
    ["5m", "1m"], // descending
    ["1h", "5m"], // descending
    ["1d", "1h"], // descending
    ["1m", "1m"], // no-op, not a step
  ];
  for (const [from, to] of bad) {
    let threw = false;
    try {
      levelRollupSql(from, to, RANGE_FROM, RANGE_TO);
    } catch (error) {
      threw = error instanceof Error;
    }
    assert(threw, `levelRollupSql(${from}, ${to}) must throw — it is not an adjacent forward step`);
  }
}

/** Assertions for `E1.3`'s health roll-up SQL builders (ADR 0050 + Amendment 1, ADR 0014 §4.6). */
export async function runHealthRollupSqlTests(): Promise<void> {
  testRawRollupJoinsAssetsForTenantContainment();
  testRawRollupHasNoElseBranch();
  testRawRollupWritesZeroWhenEveryRuleIsUnevaluatable();
  testLevelRollupJoinsAssetsForTenantContainment();
  testRawRollupInnerJoinsMatched();
  testRawRollupUpsertsRatherThanIgnoring();
  testRawRollupIntervalIsDerivedNotLiteral();
  testRawRollupWritesTheRightRelation();
  testRawRollupBindsRangeAsParametersNotLiterals();
  testLevelRollupUsesSumForCountsAndMaxForRuleTallies();
  testLevelRollupWritesTheCorrectRelationsAndInterval();
  testLevelRollupRejectsNonAdjacentAndDescendingPairs();
}
