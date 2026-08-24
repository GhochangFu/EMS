-- E7.1a / ADR 0045 Amendment 3. Follows `0044`.
--
-- `bms_owner` needs `SELECT` on the four continuous aggregates in its own right.
--
-- `0042` re-granted them to `bms_tenant` and `bms_fleet` but not to the schema
-- owner, because until `0044` the owner reached them through the *inheriting*
-- `bms_rollup` membership. The gap was there all along and the inheritance hid
-- it; removing the inheritance is what made it visible. That is the same shape
-- as the `ALTER DEFAULT PRIVILEGES FOR ROLE bms_app` hole `0041` closed — a
-- privilege that appeared to be held for one reason while actually resting on
-- another.
--
-- What it broke, and why the symptom pointed somewhere else entirely:
-- `pnpm db:refresh-aggregates` reads `SELECT count(*)` from each view after
-- refreshing it, and `information_schema.columns` is privilege-filtered — so
-- with no `SELECT`, the rollups vanished from the owner's view of the catalog
-- and the assertion failed with
--   `telemetry.point_values_1m does not exist — migration 0027 did not land`.
-- Migration 0027 was fine.
--
-- `SELECT` only, and deliberately not ownership: the owner reads the rollups; it
-- refreshes or drops them only by taking `bms_rollup` explicitly, which is the
-- boundary `0044` exists to enforce.
--
-- Forward-only and idempotent (AGENTS.md §4). Runs as `bms_app`; `bms_rollup`
-- owns these objects and `bms_owner` cannot grant on them without taking the
-- role, so there is deliberately no `SET ROLE` here.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT view_schema, view_name FROM timescaledb_information.continuous_aggregates
     WHERE view_schema IN ('bms', 'telemetry')
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO bms_owner', r.view_schema, r.view_name);
  END LOOP;
END
$$;

-- Default privileges for objects `bms_rollup` creates later, so a continuous
-- aggregate added after this migration reaches all three roles without a fourth
-- grant migration. `0042` set the `bms_tenant`/`bms_fleet` half; this adds the
-- owner and covers `bms` as well as `telemetry`, matching the schemas both of
-- `0042`'s loops actually scan.
ALTER DEFAULT PRIVILEGES FOR ROLE bms_rollup IN SCHEMA telemetry
  GRANT SELECT ON TABLES TO bms_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_rollup IN SCHEMA bms
  GRANT SELECT ON TABLES TO bms_owner, bms_tenant, bms_fleet;

-- Prove the read actually landed, in the migration itself. A missing grant here
-- is invisible until something reads the catalog rather than the data, and then
-- reports a migration that did land as missing.
DO $$
DECLARE unreadable text;
BEGIN
  SELECT string_agg(format('%s.%s', a.view_schema, a.view_name), ', ')
    INTO unreadable
    FROM timescaledb_information.continuous_aggregates a
    JOIN pg_class c ON c.relname = a.view_name
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = a.view_schema
   WHERE a.view_schema IN ('bms', 'telemetry')
     AND NOT has_table_privilege('bms_owner', c.oid, 'SELECT');
  IF unreadable IS NOT NULL THEN
    RAISE EXCEPTION 'bms_owner still cannot read: %', unreadable;
  END IF;
END
$$;
