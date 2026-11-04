-- F4.311 / ADR 0109 decision 7 - bms.calc_backfill_runs: one row per calculated-point
-- backfill run (queued -> running -> done | failed), the durable record the BullMQ
-- job reads and the API reports on.
--
-- "One active run per point" is the partial unique index
-- calc_backfill_runs_one_active (asset_point_id) WHERE status IN ('queued','running');
-- the API maps its 23505 to 409. status is a closed vocabulary the engine branches
-- on, hence a CHECK (AGENTS.md 4.8). The window CHECK bounds a run to 31 days.
-- asset_point_id is ON DELETE CASCADE: a run is meaningless without its point.
-- organization_id and requested_by carry no ON DELETE clause (organizations and
-- users are retire-only).
--
-- EVERY POLICY CHECKS ITS ORG-BEARING PARENT, NOT ONLY ITS OWN COLUMN (the
-- 0050 / 0082 shape). Postgres runs a foreign-key check with row security off,
-- so without the EXISTS below a tenant could file a run under its own
-- organization_id against another organization's asset_points row: hold that
-- point's one active slot (a 409 for its owner) and have the worker compute
-- for a point it does not own. Both halves, USING and WITH CHECK, with no NULL
-- disjunct. users carries no organization, so requested_by needs no check.
--
-- WHY THIS FILE WRITES NO GRANT. 0041_bms_owner_and_force_rls.sql sets ALTER
-- DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE,
-- DELETE ON TABLES TO bms_tenant, bms_fleet (and the sequence half). Default
-- privileges fire only for objects created by the role they name, so the table is
-- created as bms_owner inside SET ROLE / RESET ROLE: created as bms_app it would
-- reach no pool role. The same sentence is in 0117_trend_points.sql.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.calc_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  asset_point_id uuid NOT NULL REFERENCES bms.asset_points(id) ON DELETE CASCADE,
  from_at timestamptz NOT NULL,
  to_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'queued',
  done_through timestamptz,
  written_rows integer NOT NULL DEFAULT 0,
  error text,
  requested_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calc_backfill_runs_status_check CHECK (status IN ('queued','running','done','failed')),
  CONSTRAINT calc_backfill_runs_window_check CHECK (from_at < to_at AND to_at - from_at <= interval '31 days'),
  CONSTRAINT calc_backfill_runs_written_check CHECK (written_rows >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS calc_backfill_runs_one_active
  ON bms.calc_backfill_runs(asset_point_id) WHERE status IN ('queued','running');

CREATE INDEX IF NOT EXISTS calc_backfill_runs_point_created_idx
  ON bms.calc_backfill_runs(asset_point_id, created_at DESC);

ALTER TABLE bms.calc_backfill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.calc_backfill_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.calc_backfill_runs;
CREATE POLICY tenant_isolation ON bms.calc_backfill_runs
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.asset_points p
             WHERE p.id = calc_backfill_runs.asset_point_id
               AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.asset_points p
             WHERE p.id = calc_backfill_runs.asset_point_id
               AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

RESET ROLE;

-- The proof, as the migrator's own superuser role: an index that is missing or not
-- partial-unique, or RLS that is not forced, reads correct in this file and guards
-- nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms'
       AND c.relname = 'calc_backfill_runs'
       AND ic.relname = 'calc_backfill_runs_one_active'
       AND i.indisunique
       AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'migration 0123: partial unique index calc_backfill_runs_one_active is missing on bms.calc_backfill_runs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms'
       AND c.relname = 'calc_backfill_runs'
       AND c.relrowsecurity
       AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'migration 0123: row level security is not enabled and forced on bms.calc_backfill_runs';
  END IF;
END $$;
