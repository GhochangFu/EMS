-- ADR 0023 — telemetry continuous aggregates (F4.1).
--
-- Four hierarchical continuous aggregates over telemetry.point_values:
--   point_values_1m  ← point_values (raw)
--   point_values_5m  ← point_values_1m
--   point_values_1h  ← point_values_5m
--   point_values_1d  ← point_values_1h
--
-- Additive and forward-only. Nothing here backfills: ADR 0023 measured fact 1
-- is that `refresh_continuous_aggregate()` cannot run inside a transaction
-- block, and Drizzle's node-postgres migrator wraps this file in one. Every
-- view is therefore created WITH NO DATA and the backfill is
-- `pnpm db:refresh-aggregates`, which CI runs after `db:seed`.
--
-- THREE PROPERTIES THIS FILE MUST KEEP. Each was measured on 2026-08-10
-- against TimescaleDB 2.29.1 / PG 16.14, and each is asserted by
-- `apps/api/src/telemetry/point-aggregates.integration.test.ts`:
--
-- 1. NO `avg_value` COLUMN, AT ANY LEVEL. `avg` does not compose. Building the
--    hourly figure as avg(avg_value) over minute buckets was wrong in 151 of
--    169 buckets (worst 0.58 kW) because sample_count per minute ranges 1–60 on
--    real pilot data. Store sum_value + sample_count; divide at read time.
--    A total-level check does NOT catch the error — summed over the window both
--    forms gave 2311.9, because the per-bucket errors cancel.
--
-- 2. `timescaledb.materialized_only = false` ON ALL FOUR. On 2.29.1 the default
--    is TRUE, which is the opposite of what a real-time platform needs: a fresh
--    aggregate returned 0 rows while raw data existed, and a refresh lagging by
--    1 h left the newest bucket 1 h 35 m behind the newest raw row. With FALSE,
--    the live branch is exact — 7.1e-14 against raw, three levels deep, with
--    nothing materialized at all.
--
-- STANDING OBLIGATION, in the class of ADR 0021 decision 6. Any DELETE from
-- telemetry.point_values must be followed by
--   CALL refresh_continuous_aggregate('telemetry.point_values_1m', <from>, <to>);
-- and the same for _5m, _1h, _1d, finest first. Reproduced 2026-08-10: deleting a
-- raw row behind the watermark leaves the aggregate row readable, and NO scheduled
-- policy repairs it — the start_offset windows never reach that far back.
--
-- This is not hypothetical. 0014_remove_smoc_pretoria_north.sql and
-- 0021_remove_onboarding_demo_locations.sql both DELETE FROM
-- telemetry.point_values; both predate these aggregates. The next migration of
-- that shape, or any erasure request, would otherwise leave per-minute
-- sum/count/min/max per (asset_id, point_key) readable in four views forever —
-- and ADR 0023 decision 7 makes _1h/_1d the long-term record.

-- 3. end_offset(L) >= end_offset(source) + bucket_width(L). A level that
--    materialises a bucket its source has not completed stores an UNDERSTATED
--    figure, and the live branch cannot repair it — for an already-materialized
--    bucket the stored value wins. It stays wrong until a later run happens to
--    re-cover it inside start_offset. Nothing errors. See the floors below.

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry.point_values_1m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 minute', "time") AS bucket,
  asset_id,
  point_key,
  sum(value)  AS sum_value,
  count(*)    AS sample_count,
  min(value)  AS min_value,
  max(value)  AS max_value,
  max(unit)   AS unit
FROM telemetry.point_values
GROUP BY 1, 2, 3
WITH NO DATA;
--> statement-breakpoint

-- Every level above _1m composes its source's columns. NOT count(*) — at the
-- 5m level count(*) counts minute buckets, not samples, and would divide by 5
-- instead of by 60.
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry.point_values_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '5 minutes', bucket) AS bucket,
  asset_id,
  point_key,
  sum(sum_value)    AS sum_value,
  sum(sample_count) AS sample_count,
  min(min_value)    AS min_value,
  max(max_value)    AS max_value,
  max(unit)         AS unit
FROM telemetry.point_values_1m
GROUP BY 1, 2, 3
WITH NO DATA;
--> statement-breakpoint

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry.point_values_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 hour', bucket) AS bucket,
  asset_id,
  point_key,
  sum(sum_value)    AS sum_value,
  sum(sample_count) AS sample_count,
  min(min_value)    AS min_value,
  max(max_value)    AS max_value,
  max(unit)         AS unit
FROM telemetry.point_values_5m
GROUP BY 1, 2, 3
WITH NO DATA;
--> statement-breakpoint

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry.point_values_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', bucket) AS bucket,
  asset_id,
  point_key,
  sum(sum_value)    AS sum_value,
  sum(sample_count) AS sample_count,
  min(min_value)    AS min_value,
  max(max_value)    AS max_value,
  max(unit)         AS unit
FROM telemetry.point_values_1h
GROUP BY 1, 2, 3
WITH NO DATA;
--> statement-breakpoint

-- Refresh policies. `start_offset` is deliberately far wider than
-- `end_offset`: ADR 0007's MQTT path gives no ordering guarantee, so a window
-- covering only the present silently drops late arrivals.
--
--   View | source | schedule | start_offset | end_offset | invariant floor
--   _1m  | raw    | 1 min    | 3 h          | 1 min      | 1 min  (raw never lags)
--   _5m  | _1m    | 5 min    | 12 h         | 10 min     | 6 min
--   _1h  | _5m    | 30 min   | 3 d          | 2 h        | 1 h 10 min
--   _1d  | _1h    | 1 h      | 30 d         | 2 d        | 1 d 2 h
--
-- The end_offset values exceed their floors on purpose. The cost is that more
-- of a read near the tail is served by the live branch instead of stored rows —
-- CPU, not correctness (property 2 above). That is strictly better than
-- materialising an understated bucket no error surfaces.
SELECT add_continuous_aggregate_policy('telemetry.point_values_1m',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('telemetry.point_values_5m',
  start_offset => INTERVAL '12 hours',
  end_offset   => INTERVAL '10 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('telemetry.point_values_1h',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '2 hours',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_continuous_aggregate_policy('telemetry.point_values_1d',
  start_offset => INTERVAL '30 days',
  end_offset   => INTERVAL '2 days',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
