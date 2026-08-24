-- E7.1a / ADR 0045 (2026-08-24). Follows `0041`.
--
-- A defect found while verifying `0041` against the running stack, and fixed
-- here on the owner's ruling rather than filed.
--
-- `refresh_continuous_aggregate` requires **ownership** of the aggregate, and no
-- GRANT substitutes for it. Since `F4.16` (ADR 0043 decision 8) the API connects
-- as `bms_tenant`/`bms_fleet`, which own nothing — so the post-commit refresh in
-- `TelemetryWriteService` and `CalcWriteService` has been failing with
--   `must be owner of continuous aggregate "point_values_1m"`
-- and being swallowed as a `WARN` ever since. Its integration test passed only
-- because the test pool was the `bms_app` superuser; `0041` exposed it by making
-- that pool non-superuser.
--
-- **This is a correctness defect, not a latency one.** The refresh policies carry
-- bounded `start_offset`s — 3 h, 12 h, 3 days, 30 days — and real-time
-- aggregation covers only data not yet materialised. A reading written outside
-- its level's window is therefore *permanently* absent from that rollup, with
-- nothing but a warning to say so.
--
-- A `SECURITY DEFINER` wrapper was tried first and is not available: TimescaleDB
-- refuses with `refresh_continuous_aggregate() cannot be executed from a
-- function`. Granting `bms_owner` to the pool roles would have worked and was
-- rejected — it owns both entire schemas, so it hands the API full DDL.
--
-- So: a role that owns the four aggregates and **nothing else**. `db:roles`
-- creates it and grants membership to `bms_owner` (for
-- `pnpm db:refresh-aggregates`), `bms_tenant` and `bms_fleet` (for the
-- post-commit refresh). The residual risk is stated rather than hidden: a role
-- that can refresh an aggregate can also drop it. That is bounded next to the
-- DELETE `bms_tenant` already holds on every table in both schemas.
--
-- Forward-only and idempotent (AGENTS.md §4). It runs as `bms_app`, which is a
-- superuser and can therefore re-own objects `0041` gave to `bms_owner`; there
-- is no `SET ROLE` here because every statement needs privileges `bms_owner`
-- does not have over a role it is merely a member of.

GRANT USAGE ON SCHEMA telemetry TO bms_rollup;

-- `_1m` reads the raw hypertable; each higher level reads the level below it.
-- The refresh runs as the aggregate's owner, so that owner needs SELECT on
-- whatever its own definition reads.
GRANT SELECT ON telemetry.point_values TO bms_rollup;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT view_schema, view_name FROM timescaledb_information.continuous_aggregates
     WHERE view_schema IN ('bms', 'telemetry')
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO bms_rollup', r.view_schema, r.view_name);
    -- `ALTER MATERIALIZED VIEW`, not `ALTER VIEW`: a continuous aggregate has
    -- `relkind = 'v'`, so a generic view loop finds it and then fails with
    -- `cannot alter continuous aggregate using ALTER VIEW`. The materialization
    -- hypertable, its indexes, its chunks and its refresh policy's job owner
    -- all follow this statement.
    EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO bms_rollup',
                   r.view_schema, r.view_name);
  END LOOP;
END
$$;

-- The pool roles already hold DML on everything in `telemetry` from `0039`, but
-- that grant was made against objects owned by `bms_app` and re-granted by
-- `0041`'s default privileges for `bms_owner`. The aggregates have just changed
-- owner again, so re-assert the read grant the API needs on them explicitly
-- rather than assuming it survived.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT view_schema, view_name FROM timescaledb_information.continuous_aggregates
     WHERE view_schema IN ('bms', 'telemetry')
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO bms_tenant, bms_fleet',
                   r.view_schema, r.view_name);
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE bms_rollup IN SCHEMA telemetry
  GRANT SELECT ON TABLES TO bms_tenant, bms_fleet;
