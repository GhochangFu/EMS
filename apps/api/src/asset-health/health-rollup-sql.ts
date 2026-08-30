import { sql, type SQL } from "drizzle-orm";

import type { AggregateLevel } from "../telemetry/point-aggregates";
import { bucketSeconds } from "../telemetry/point-aggregates";
import { firesCaseSql } from "./in-range-sql";

/**
 * `E1.3` (ADR 0050 + Amendment 1) — the SQL half of the health roll-up.
 *
 * Two builders, both pure: no database call, no clock. Each returns a drizzle
 * `SQL` object, not a `(text, values)` string pair. That is what
 * `withTenant`'s `tx.execute(sql\`...\`)` — `../database/tenant-context.ts` —
 * and every other raw-SQL call site in `apps/api` (`calc-write.service.ts`,
 * `telemetry-write.service.ts`) actually run: `tx.execute()` takes an
 * `SQLWrapper`, and a plain string carries no way to bind parameter values
 * through it. `TelemetryService.pointAggregate`'s `pool.query(text, params)`
 * with `$n` placeholders is a different, narrower exception — it runs
 * against `TENANT_POOL` directly because `telemetry.*` carries no Row Level
 * Security (ADR 0048), so nothing there needs a tenant-scoped transaction.
 * This roll-up reads `bms.automation_rules`, which IS forced-RLS (ADR 0043),
 * and ADR 0050 decision 8 requires it read as the tenant role with that
 * organization's context set — exactly what `withTenant` exists for. So this
 * module composes with `sql`/`sql.raw`, matching the transaction it must run
 * inside, not the pool-based module it happens to sit next to.
 *
 * **`sql.raw()` is for structural text only — a relation name, a computed
 * interval literal, the generated `fires()` CASE, the shared column list and
 * `ON CONFLICT` clause.** None of those are end-user input; they come from
 * closed lookups or from `firesCaseSql`'s own identifier guard. **The range
 * bounds are the only real values, and they are bound as `${from}`/`${to}`
 * inside the `sql` template — never `sql.raw` — so a timestamp is a
 * parameter, not text concatenated into the query.**
 *
 * **`AggregateLevel` and `bucketSeconds` come from `./point-aggregates`.**
 * `point-aggregate-window.ts` imports both from there without re-exporting
 * them, so `point-aggregates.ts` is the only place either is actually
 * declared — importing from it directly is still "the one ladder" ADR 0050
 * decision 6 asks for, not a second one.
 */

/**
 * Fully-qualified relation per level, closed over the four `E1.3` tables.
 *
 * A `Record<AggregateLevel, string>`, matching `aggregateRelation`'s own
 * closed map in `point-aggregates.ts` — table names are interpolated into SQL
 * here, so they come from a lookup against a closed set, never from a caller
 * string.
 */
const RELATION: Record<AggregateLevel, string> = {
  "1m": "telemetry.point_in_range_1m",
  "5m": "telemetry.point_in_range_5m",
  "1h": "telemetry.point_in_range_1h",
  "1d": "telemetry.point_in_range_1d",
};

/**
 * The write-order adjacency the roll-up must walk, finest first — ADR 0050
 * decision 9 as extended by Amendment 1 decision 8: `1m → 5m → 1h → 1d`.
 *
 * This is **not** a second copy of `point-aggregate-window.ts`'s read-side
 * ladder (ADR 0050 decision 6 forbids that one). That ladder picks a level to
 * *read* from a window length; this one only says which relation a coarser
 * level may be *derived from* when the roll-up job walks the four tables in
 * order. The two answer different questions and neither can substitute for
 * the other, so declaring this table is not the drift decision 6 warns about.
 *
 * Closed over `AggregateLevel` (like `SQL_COMPARATOR` in `./in-range-sql.ts`)
 * so a fifth level added to the type would fail this file's build rather than
 * silently having no defined predecessor.
 */
const NEXT_LEVEL: Record<AggregateLevel, AggregateLevel | null> = {
  "1m": "5m",
  "5m": "1h",
  "1h": "1d",
  "1d": null,
};

/** `'<n> seconds'::interval` for a level's own bucket width, never a hand-written literal. */
function intervalLiteral(level: AggregateLevel): string {
  return `'${bucketSeconds(level)} seconds'::interval`;
}

const COLUMNS =
  "(bucket, asset_id, point_key, in_range_count, sample_count, rule_count, skipped_rule_count, computed_at)";

const ON_CONFLICT_UPDATE = `
ON CONFLICT (bucket, asset_id, point_key) DO UPDATE SET
  in_range_count = EXCLUDED.in_range_count,
  sample_count = EXCLUDED.sample_count,
  rule_count = EXCLUDED.rule_count,
  skipped_rule_count = EXCLUDED.skipped_rule_count,
  computed_at = EXCLUDED.computed_at`;

/**
 * Rolls raw `telemetry.point_values` into `telemetry.point_in_range_1m` for
 * one time range, `[from, to)`. Both bounds are bound query parameters.
 *
 * Five things below are each silently wrong if changed; each is also asserted
 * in `health-rollup-sql.spec.ts`.
 *
 * 1. **`JOIN bms.assets a` is tenant containment, and nothing else uses
 *    `a`.** `telemetry.*` carries no Row Level Security (ADR 0043) — nothing
 *    in this statement's own tables limits it to one organization. `bms.assets`
 *    is org-bearing and forced, so as the tenant role (ADR 0050 decision 8)
 *    this join is what confines the sweep to the caller's own org. A reviewer
 *    will see an unused alias and want to delete it; do not.
 * 2. **The `NOT EXISTS` wraps an `ELSE`-less `CASE` (`firesCaseSql`).** That
 *    `CASE` is SQL `NULL` for a rule with a NULL `operator`/`threshold_value`,
 *    and `WHERE NULL` never satisfies `EXISTS` — so an unevaluatable rule
 *    neither fires nor makes the sample in-range by fiat. It is counted
 *    separately via `skipped_rule_count`, from `matched`, not from this
 *    `NOT EXISTS`.
 * 3. **`JOIN matched` (inner, not `LEFT JOIN`) is what gives a row only to a
 *    tag some threshold rule matches.** ADR 0050 decision 3: an unruled tag
 *    gets no row in this relation at all — a `LEFT JOIN` would write one for
 *    every tag with telemetry and defeat the decision.
 * 4. **`ON CONFLICT … DO UPDATE`, never `DO NOTHING`.** A re-run must
 *    re-evaluate against the CURRENT rule set (ADR 0050 decision 4) — editing
 *    a threshold and re-scoring history is a supported operation, and
 *    `DO NOTHING` would freeze the first evaluation forever.
 * 5. **The bucket width is `intervalLiteral("1m")` — derived from
 *    `bucketSeconds`, never a hand-written `'1 minute'`.** A literal would
 *    silently disagree with `BUCKET_SECONDS["1m"]` in `point-aggregates.ts` if
 *    that ever changed; this cannot, because it reads the same constant.
 */
export function rawRollupSql(from: Date, to: Date): SQL {
  return sql`
WITH matched AS (
  SELECT r.asset_id, r.point_key,
         count(*) FILTER (WHERE r.operator IS NOT NULL AND r.threshold_value IS NOT NULL) AS rule_count,
         count(*) FILTER (WHERE r.operator IS NULL OR r.threshold_value IS NULL) AS skipped_rule_count
    FROM bms.automation_rules r
   WHERE r.rule_type = 'threshold' AND r.enabled AND r.lifecycle_status = 'published'
     AND r.asset_id IS NOT NULL AND r.point_key IS NOT NULL
   GROUP BY r.asset_id, r.point_key
)
INSERT INTO ${sql.raw(RELATION["1m"])}
       ${sql.raw(COLUMNS)}
SELECT time_bucket(${sql.raw(intervalLiteral("1m"))}, pv.time), pv.asset_id, pv.point_key,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM bms.automation_rules r2
          WHERE r2.rule_type = 'threshold' AND r2.enabled AND r2.lifecycle_status = 'published'
            AND r2.asset_id = pv.asset_id AND r2.point_key = pv.point_key
            AND ${sql.raw(firesCaseSql("pv.value", "r2.operator", "r2.threshold_value"))}
       )) AS in_range_count,
       count(*) AS sample_count,
       m.rule_count, m.skipped_rule_count, now()
  FROM telemetry.point_values pv
  JOIN bms.assets a ON a.id = pv.asset_id
  JOIN matched m ON m.asset_id = pv.asset_id AND m.point_key = pv.point_key
 WHERE pv.time >= ${from} AND pv.time < ${to}
 GROUP BY 1, 2, 3, m.rule_count, m.skipped_rule_count
${sql.raw(ON_CONFLICT_UPDATE)}
`;
}

/**
 * Derives `toLevel`'s bucket from `fromLevel`'s already-materialized rows for
 * one time range, `[from, to)` over `fromLevel`'s own `bucket` column. Both
 * bounds are bound query parameters.
 *
 * `fromLevel`/`toLevel` must be an adjacent step on {@link NEXT_LEVEL} —
 * `1m→5m`, `5m→1h`, `1h→1d`. A non-adjacent pair (`1m→1h`) or a descending one
 * (`5m→1m`) throws rather than silently deriving a coarse level straight from
 * one two rungs down, which ADR 0050 decision 9 / Amendment 1 decision 8's
 * ordering forbids — deriving `1d` straight from `1m` would work
 * arithmetically and would bypass a fine-first re-run's whole point.
 *
 * **`sum` for `in_range_count`/`sample_count`, `max` for
 * `rule_count`/`skipped_rule_count`.** The counts compose by `sum` — that is
 * ADR 0050 decision 4's reason this is a relation rather than a CAGG column.
 * The rule tallies do NOT: they describe the tag (how many threshold rules
 * matched it), not the bucket, so `sum`-ing them across (say) sixty `1m`
 * buckets would multiply a tag's own rule count by sixty. `sum` on all four
 * columns is the shape that looks obviously right and is wrong on two of
 * them — asserted in the spec, not only stated here.
 */
export function levelRollupSql(
  fromLevel: AggregateLevel,
  toLevel: AggregateLevel,
  from: Date,
  to: Date,
): SQL {
  if (NEXT_LEVEL[fromLevel] !== toLevel) {
    throw new Error(
      `levelRollupSql: "${fromLevel}" -> "${toLevel}" is not an adjacent step on the roll-up ` +
        'ladder ("1m"->"5m", "5m"->"1h", "1h"->"1d"). ADR 0050 decision 9 / Amendment 1 decision 8 ' +
        "require deriving each level only from the one immediately below it, finest first.",
    );
  }

  const fromRelation = RELATION[fromLevel];
  const toRelation = RELATION[toLevel];

  return sql`
INSERT INTO ${sql.raw(toRelation)}
       ${sql.raw(COLUMNS)}
SELECT time_bucket(${sql.raw(intervalLiteral(toLevel))}, f.bucket), f.asset_id, f.point_key,
       sum(f.in_range_count) AS in_range_count,
       sum(f.sample_count) AS sample_count,
       max(f.rule_count) AS rule_count,
       max(f.skipped_rule_count) AS skipped_rule_count,
       now()
  FROM ${sql.raw(fromRelation)} f
 WHERE f.bucket >= ${from} AND f.bucket < ${to}
 GROUP BY 1, 2, 3
${sql.raw(ON_CONFLICT_UPDATE)}
`;
}
