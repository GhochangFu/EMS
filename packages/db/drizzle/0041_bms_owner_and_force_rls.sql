-- E7.1a / ADR 0045 + Amendment 1 (2026-08-24).
--
-- Gives `bms` and `telemetry` a non-superuser owner, `bms_owner`, so that
-- `FORCE ROW LEVEL SECURITY` stops being decorative. Before this file the API's
-- `DATABASE_URL` named `bms_app`, the initdb bootstrap superuser, and a
-- superuser bypasses every policy regardless of `FORCE` — so ADR 0043 decision
-- 8's control was exempt for the one connection it named.
--
-- **This file runs as `bms_app` on purpose, and it is the last thing `bms_app`
-- does to the schema as itself.** Everything below the `SET ROLE` marker runs
-- as the constrained owner, which proves in the migration itself that
-- `bms_owner` can issue `FORCE` on tables it now owns.
--
-- Forward-only and idempotent (AGENTS.md §4): `ALTER ... OWNER TO` on an object
-- already owned is a no-op, and `FORCE ROW LEVEL SECURITY` re-asserted is a
-- no-op. `0039` and `0040` are untouched — drizzle keys its journal by file
-- hash, so editing either would re-run it on every existing deployment.
--
-- **Why enumerated loops rather than `REASSIGN OWNED BY bms_app`.** ADR 0045
-- decision 4 named `REASSIGN OWNED`, and Amendment 1 replaced it after
-- measuring that it errors on every deployment shape:
--
--     ERROR:  cannot reassign ownership of objects owned by role bms_app
--             because they are required by the database system
--
-- `POSTGRES_USER: bms_app` makes it the initdb bootstrap superuser, so its oid
-- is 10 — a *pinned* role, against which PostgreSQL records no `pg_shdepend`
-- owner rows. `REASSIGN OWNED` refuses outright rather than no-opping.

ALTER SCHEMA bms OWNER TO bms_owner;
ALTER SCHEMA telemetry OWNER TO bms_owner;

-- Ordinary tables. TimescaleDB chunks live in `_timescaledb_internal` and are
-- not listed here; they follow their parent hypertable, including compressed
-- chunks (verified against TimescaleDB 2.29.1-pg16 before this file was
-- written).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename FROM pg_tables
     WHERE schemaname IN ('bms', 'telemetry')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO bms_owner', r.schemaname, r.tablename);
  END LOOP;
END
$$;

-- ADR 0023's four continuous aggregates. `ALTER MATERIALIZED VIEW`, not
-- `ALTER VIEW`: a continuous aggregate has `relkind = 'v'`, so a generic view
-- loop finds it and then fails on all four with
--   `cannot alter continuous aggregate using ALTER VIEW`.
-- The materialization hypertable, its indexes and its chunks follow this
-- statement.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT view_schema, view_name FROM timescaledb_information.continuous_aggregates
     WHERE view_schema IN ('bms', 'telemetry')
  LOOP
    EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO bms_owner',
                   r.view_schema, r.view_name);
  END LOOP;
END
$$;

-- Ordinary views, excluding the continuous aggregates handled above. Empty
-- today; the exclusion is what keeps that true if one is added later.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT v.schemaname, v.viewname FROM pg_views v
     WHERE v.schemaname IN ('bms', 'telemetry')
       AND NOT EXISTS (
         SELECT 1 FROM timescaledb_information.continuous_aggregates c
          WHERE c.view_schema = v.schemaname AND c.view_name = v.viewname
       )
  LOOP
    EXECUTE format('ALTER VIEW %I.%I OWNER TO bms_owner', r.schemaname, r.viewname);
  END LOOP;
END
$$;

-- Sequences. Zero today — every key in both schemas is a uuid — and the loop
-- ships anyway. `0039`'s own comment makes exactly this argument for its
-- sequence grants: a serial column added later would otherwise be owned by
-- nobody this migration reaches, and that failure surfaces one endpoint at a
-- time, long after the change that caused it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, sequencename FROM pg_sequences
     WHERE schemaname IN ('bms', 'telemetry')
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO bms_owner', r.schemaname, r.sequencename);
  END LOOP;
END
$$;

-- `0039:68-77` set these `FOR ROLE bms_app`, and default privileges apply only
-- to objects created by the role they name. From this migration onward new
-- objects are created by `bms_owner` — so without these four statements every
-- table a later migration adds would reach no pool role at all, and the API
-- would start failing on it one endpoint at a time. That is the exact failure
-- `0039`'s own comment warns about, and it would be re-introduced by the fix.
--
-- All four of `0039`'s statements are mirrored, SEQUENCES as well as TABLES.
-- The zero sequence count above is not a reason to omit the sequence half.
ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA telemetry
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms
  GRANT USAGE, SELECT ON SEQUENCES TO bms_tenant, bms_fleet;
ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA telemetry
  GRANT USAGE, SELECT ON SEQUENCES TO bms_tenant, bms_fleet;

-- ── Everything below runs as the constrained owner ────────────────────────
--
-- ADR 0045 decision 6 makes this the rule for every migration authored after
-- the ADR. Here it is also the proof: `FORCE ROW LEVEL SECURITY` requires
-- ownership, so these five statements succeeding is evidence that the loops
-- above did their job.
SET ROLE bms_owner;

-- The five tables migration `0040` gave `ENABLE ROW LEVEL SECURITY` and a
-- `tenant_isolation` policy. `ENABLE` exempts the table owner; `FORCE` does
-- not. `E7.1b` extends both to the rest of ADR 0043 decision 5's table set.
ALTER TABLE bms.locations                 FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.user_organization_access  FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.point_keys                FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_templates           FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.onboarding_sessions       FORCE ROW LEVEL SECURITY;

-- Mandatory, not tidiness. A forgotten `RESET ROLE` leaks past `COMMIT` into
-- the session, so the drizzle migrator's own journal write — and every later
-- migration in the same run — would execute as `bms_owner`, which holds no
-- grant on the `drizzle` schema. `tests/adr-0045-owner-and-superuser-url.test.ts`
-- asserts every migration after this one that issues `SET ROLE` also issues
-- `RESET ROLE`.
RESET ROLE;
