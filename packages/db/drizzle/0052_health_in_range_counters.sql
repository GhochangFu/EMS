-- ADR 0050 + Amendment 1 — the in-range counter behind the asset health score (E1.3).
--
-- Four plain tables over telemetry.point_values, one per ADR 0023 level:
--   point_in_range_1m  ← point_values (raw)
--   point_in_range_5m  ← point_in_range_1m
--   point_in_range_1h  ← point_in_range_5m
--   point_in_range_1d  ← point_in_range_1h
--
-- Additive and forward-only. Nothing here backfills; the roll-up job writes
-- every row (ADR 0050 decision 4), and its 24-hour trailing window at `1m`
-- (Amendment 1 decision 4) is what repairs a missed tick.
--
-- ============================================================================
-- STANDING OBLIGATION — READ THIS BEFORE DELETING FROM telemetry.point_values.
-- ============================================================================
--
-- ADR 0050 decision 9, extended by Amendment 1 decision 8. Any
--
--   DELETE FROM telemetry.point_values WHERE ...
--
-- must be followed by BOTH of these, and the order inside each is not optional:
--
--   1. `0027_continuous_aggregates.sql`'s own obligation —
--      CALL refresh_continuous_aggregate('telemetry.point_values_1m', <from>, <to>);
--      then _5m, then _1h, then _1d.
--   2. A re-run of the health roll-up over the same range, FINEST FIRST:
--      point_in_range_1m, then point_in_range_5m, then point_in_range_1h, then
--      point_in_range_1d.
--
-- Deriving a coarse level from a stale fine one propagates the error upward, so
-- (2) is ordered for the same reason (1) is.
--
-- NO SCHEDULED POLICY REPAIRS THIS. The job's trailing window is 24 hours; a
-- deletion older than that is never revisited, and the failure is silent — a
-- deleted raw row leaves a stale in-range count that reads as a correct score
-- forever. `0027`'s header carries the same warning for the aggregates and is
-- the reason this one is written here rather than only in the ADR.
--
-- ============================================================================
-- WHY FOUR TABLES AND NOT ONE WITH A `level` COLUMN. (Amendment 1 decision 1.)
-- ============================================================================
--
-- The load-bearing reason is horizons, not readability. Migration `0028` gives
-- telemetry.point_values, _1m and _5m three different retention intervals, and
-- ADR 0023 decision 7 keeps _1h and _1d forever. These four will want the same
-- treatment when they have volume, and ONE TABLE CANNOT CARRY FOUR HORIZONS.
--
-- Second: the four-table form gets from the table name what a `level` column
-- makes every single read carry as a predicate, and a forgotten predicate does
-- not error — it sums four levels into one ratio that is silently wrong.
--
-- Third: ADR 0050 decision 6 forbids a second ladder. Four tables keep a 1:1
-- with the four aggregates `point-aggregate-window.ts` already names, so
-- `levelFor()` maps to a relation with no translation table to drift.
--
-- ============================================================================
-- WHY `SET ROLE bms_owner`, AND WHY NO GRANT STATEMENT IS WRITTEN.
-- ============================================================================
--
-- `0041_bms_owner_and_force_rls` lines 112-119 set `ALTER DEFAULT PRIVILEGES
-- FOR ROLE bms_owner` in BOTH `bms` AND `telemetry`, granting SELECT/INSERT/
-- UPDATE/DELETE to bms_tenant and bms_fleet. Those fire only for objects
-- created by the role they name. `pnpm db:migrate` connects as
-- DATABASE_URL_SUPERUSER (`bms_app`), so without the bracket below these four
-- tables would be owned by `bms_app`, the default privileges would never fire,
-- and the roll-up job — which writes as the tenant role per ADR 0050 decision
-- 8 — could neither read nor write them.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it. A hand-written GRANT would be redundant AND
-- would hide a future breakage of the SET ROLE bracket, which is the failure
-- `0039`'s header describes as surfacing "one endpoint at a time". (`0050`'s
-- and `0051`'s headers say the same; this is the third table to need it.)
--
-- `bms_owner` AND NOT `bms_rollup`, though `bms_rollup` owns the ADR 0023
-- aggregates and `0045` gives it default privileges here too. `bms_rollup` owns
-- those because TimescaleDB requires a continuous aggregate's owner to run
-- `refresh_continuous_aggregate()`. A plain table imposes no such requirement,
-- and `0045` exists precisely BECAUSE bms_rollup-owned objects then needed
-- extra grants to be readable. Do not copy that shape here by symmetry.
--
-- ============================================================================
-- NO `organization_id`, NO ROW LEVEL SECURITY, NO POLICY.
-- ============================================================================
--
-- Deliberate, and consistent with the schema these tables live in. ADR 0043
-- puts RLS on `bms.*`; `telemetry.*` has none — not on `point_values`, not on
-- the four aggregates. Containment for a telemetry read is the asset-scoped
-- controller guard, exactly as it is for `point_values` today.
--
-- The tenant containment ADR 0050 decision 8 requires is on the OTHER side of
-- the job: the rules it reads live in `bms.automation_rules`, which is
-- org-bearing and forced, and the job sweeps one organization at a time with
-- that organization's context set. Adding a column here would not improve that
-- and would make these four the only RLS-bearing tables in the schema.
--
-- `tests/adr-0043-tenant-columns.test.ts` is scoped to `bms.%s` and does not
-- need an entry for these.
--
-- ============================================================================
-- WHY PLAIN TABLES AND NOT HYPERTABLES. (Amendment 1 decision 10.)
-- ============================================================================
--
-- These grow unbounded. That is accepted, with a number attached rather than
-- left to judgement: REVISIT WHEN telemetry.point_in_range_1m EXCEEDS 50
-- MILLION ROWS, or when any level's retention becomes a question anyone asks.
--
-- Converting later is cheap and reversible. Converting now would add four
-- chunking decisions and four retention horizons to a row with no production
-- volume — the current fixtures contain no tag that carries both telemetry and
-- a published threshold rule, so the accepted state is presently zero rows,
-- which is exactly the condition under which an unbounded table stays
-- unnoticed. The trigger above is the guard.
--
-- ============================================================================
-- WHEN A ROW EXISTS, AND WHAT `rule_count = 0` MEANS.
-- ============================================================================
--
-- A row exists for a (bucket, asset, point) if and only if at least one
-- threshold rule MATCHED that tag — applied or skipped. ADR 0050 decision 3
-- excludes an unruled tag from the roll-up rather than scoring it 1.0, so an
-- unruled tag gets no row at all, and `unscoredTags` is derived from the
-- asset's catalog points minus the tags that do have rows.
--
-- `rule_count` counts the rules actually EVALUATED. `skipped_rule_count` counts
-- rules that matched the tag but could not be evaluated because `operator` or
-- `threshold_value` is NULL — both are nullable in
-- `packages/db/src/schema/bms-schema.ts`, the same shape and for the same
-- reason as the `severity` column `F4.46` established. Amendment 1 decision 7:
-- a skipped rule is NEVER treated as "did not fire", because that makes the
-- sample in-range and inflates the score, which is decision 3's defect reached
-- by another road.
--
-- SO `rule_count = 0` WITH `skipped_rule_count > 0` IS A REAL STATE, and in it
-- `in_range_count` IS MEANINGLESS AND IS WRITTEN AS 0. The read must exclude
-- such a row from the ratio and count it as unscored. The CHECK below permits
-- the state on purpose; it forbids only the row that means nothing at all.
--
-- ============================================================================
-- THIS IS THE ONE LEGITIMATE RAW-TELEMETRY BUCKETING SITE, AND IT IS NOT A
-- REVERT.
-- ============================================================================
--
-- `tests/repo-invariants.test.ts` — "no rollup read reverts to bucketing raw
-- telemetry" — names `dashboard.service.ts` and `reports.service.ts` and must
-- NOT be extended to the health roll-up. ADR 0023's aggregates store
-- sum/count/min/max and no per-sample values, so the in-range predicate cannot
-- be evaluated against them at any level. Reading raw at `1m` is what ADR 0050
-- decision 4 requires, and it is why the counter is materialized once rather
-- than recomputed per request. Adding these files to that list would fail CI
-- for doing the thing the ADR specifies.

SET ROLE bms_owner;

-- 1. The `1m` level, computed from raw. Every coarser level is derived from
--    this one by `sum`, so its correctness is the only one that reads raw.
--
--    PRIMARY KEY ORDER IS (bucket, asset_id, point_key), matching
--    `telemetry.point_values`. The roll-up writes a contiguous bucket range for
--    one tag at a time, and the read scans a bucket range; both want `bucket`
--    leading.
--
--    `in_range_count` and `sample_count` are `bigint` because they compose by
--    `sum` across levels and `count(*)` is `bigint` in Postgres — the same
--    reason ADR 0023's `sample_count` is. Reading either through a driver that
--    does not cast yields a string; `telemetry-schema.ts` declares both with
--    drizzle's `{ mode: "number" }`, as it already does for `sampleCount`.
--
--    `computed_at` is Amendment 1 decision 9: there are four currency instants,
--    not one, and a `1d` figure current to 03:00 beside a `1m` figure current
--    to 03:59 is correct rather than an arithmetic bug. The read reports the
--    instant for the level it actually read, and this column is where it comes
--    from.
CREATE TABLE IF NOT EXISTS telemetry.point_in_range_1m (
  bucket timestamptz NOT NULL,
  asset_id uuid NOT NULL,
  point_key varchar(128) NOT NULL,
  in_range_count bigint NOT NULL,
  sample_count bigint NOT NULL,
  rule_count integer NOT NULL,
  skipped_rule_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, asset_id, point_key),
  CONSTRAINT point_in_range_1m_counts_check
    CHECK (sample_count > 0 AND in_range_count BETWEEN 0 AND sample_count),
  CONSTRAINT point_in_range_1m_rules_check
    CHECK (rule_count >= 0 AND skipped_rule_count >= 0
           AND rule_count + skipped_rule_count > 0)
);

-- The health read asks for one asset (or a set of them) over a window, so
-- `asset_id` leads here where the primary key leads with `bucket`. Without it
-- an asset-scoped read scans every tag in the window.
CREATE INDEX IF NOT EXISTS point_in_range_1m_asset_bucket_idx
  ON telemetry.point_in_range_1m (asset_id, bucket DESC);

-- 2-4. The coarser levels. Identical shape on purpose: the roll-up derives each
--      from the level below by `sum`, and a differing column set would make
--      that derivation level-specific for no gain. ADR 0050 decision 4 requires
--      the counter to compose by `sum` exactly as `sample_count` does, which is
--      what keeps the ladder extensible when `F2.10` adds tiers.
--
--      They are written explicitly rather than generated in a DO loop, matching
--      `0027`'s four explicit aggregates. A loop hides which level a constraint
--      belongs to in a `\d` output and in a review diff.

CREATE TABLE IF NOT EXISTS telemetry.point_in_range_5m (
  bucket timestamptz NOT NULL,
  asset_id uuid NOT NULL,
  point_key varchar(128) NOT NULL,
  in_range_count bigint NOT NULL,
  sample_count bigint NOT NULL,
  rule_count integer NOT NULL,
  skipped_rule_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, asset_id, point_key),
  CONSTRAINT point_in_range_5m_counts_check
    CHECK (sample_count > 0 AND in_range_count BETWEEN 0 AND sample_count),
  CONSTRAINT point_in_range_5m_rules_check
    CHECK (rule_count >= 0 AND skipped_rule_count >= 0
           AND rule_count + skipped_rule_count > 0)
);

CREATE INDEX IF NOT EXISTS point_in_range_5m_asset_bucket_idx
  ON telemetry.point_in_range_5m (asset_id, bucket DESC);

CREATE TABLE IF NOT EXISTS telemetry.point_in_range_1h (
  bucket timestamptz NOT NULL,
  asset_id uuid NOT NULL,
  point_key varchar(128) NOT NULL,
  in_range_count bigint NOT NULL,
  sample_count bigint NOT NULL,
  rule_count integer NOT NULL,
  skipped_rule_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, asset_id, point_key),
  CONSTRAINT point_in_range_1h_counts_check
    CHECK (sample_count > 0 AND in_range_count BETWEEN 0 AND sample_count),
  CONSTRAINT point_in_range_1h_rules_check
    CHECK (rule_count >= 0 AND skipped_rule_count >= 0
           AND rule_count + skipped_rule_count > 0)
);

CREATE INDEX IF NOT EXISTS point_in_range_1h_asset_bucket_idx
  ON telemetry.point_in_range_1h (asset_id, bucket DESC);

CREATE TABLE IF NOT EXISTS telemetry.point_in_range_1d (
  bucket timestamptz NOT NULL,
  asset_id uuid NOT NULL,
  point_key varchar(128) NOT NULL,
  in_range_count bigint NOT NULL,
  sample_count bigint NOT NULL,
  rule_count integer NOT NULL,
  skipped_rule_count integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, asset_id, point_key),
  CONSTRAINT point_in_range_1d_counts_check
    CHECK (sample_count > 0 AND in_range_count BETWEEN 0 AND sample_count),
  CONSTRAINT point_in_range_1d_rules_check
    CHECK (rule_count >= 0 AND skipped_rule_count >= 0
           AND rule_count + skipped_rule_count > 0)
);

CREATE INDEX IF NOT EXISTS point_in_range_1d_asset_bucket_idx
  ON telemetry.point_in_range_1d (asset_id, bucket DESC);

RESET ROLE;
