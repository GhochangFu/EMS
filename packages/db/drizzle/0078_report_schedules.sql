-- F3.5b — `bms.report_schedules`, and `bms.report_files.schedule_id` — ADR
-- 0071 decisions 7 and 9; F3.5b plan R-13/R-16, Q-2.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING HERE, NOT CEREMONIAL (ADR 0045
-- decision 6, `0050`/`0072`/`0077`'s headers): `FORCE ROW LEVEL SECURITY`
-- requires table ownership, and `0041_bms_owner_and_force_rls` grants
-- default privileges only to objects created BY `bms_owner`.
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (`bms_app`); without
-- the SET ROLE this table would be owned by `bms_app` and no pool role
-- could reach it.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE
-- ADDED. `0041`'s default privileges do it; a hand-written GRANT here would
-- be redundant and would hide a future breakage of the SET ROLE bracket.
--
-- `RESET ROLE;` is mandatory, not symmetry: `0041`'s comment records that a
-- leaked SET ROLE reaches the drizzle migrator's own journal write and every
-- later migration in the same run.
--
-- POLICY SHAPE — the own-column strict form, `0077`'s rule again:
-- `bms.report_schedules.organization_id` is `NOT NULL`, there is no
-- legitimate fleet-owned row, and the array columns (`formats`,
-- `location_ids`) name no foreign row, so there is nothing for an EXISTS leg
-- to guard. `channel_id`'s isolation is NOT this policy's job: the write
-- path (`ChannelsService.loadById` under `canManageNotificationChannel`,
-- F3.5b plan R-12) enforces same-organization at create/PATCH time, and this
-- table's own RLS read at render time is the backstop if that write path is
-- ever wrong — a belt on top of the write-path's braces, not a substitute
-- for it. `created_by` is not policy-checked, `0077`'s reasoning again:
-- `bms.users.organization_id` is permanently nullable (a global admin
-- belongs to no organization).
--
-- `channel_id ON DELETE SET NULL`: a deleted notification channel leaves the
-- schedule running with a visible `skipped_unconfigured` at render time (the
-- F3.8 rule — an unconfigured transport is visible), never a broken FK or a
-- 500 out of `ChannelsService.remove`.
--
-- `report_files.schedule_id` carries NO `ON DELETE` clause, i.e. `RESTRICT`,
-- Postgres's default (F3.5b plan R-13, Q-2, owner-ruled 2026-09-21: files are
-- removed with their schedule). `SET NULL` would turn a deleted schedule's
-- files into on-demand rows that consume the 50-file on-demand cap;
-- `CASCADE` would drop the rows and orphan up to `REPORT_RETENTION_PER_SCHEDULE`
-- objects with no sweep to find them. `RESTRICT` plus the schedule DELETE
-- route's own row-then-object delete (report_files rows removed first, in
-- the same tenant transaction, then the schedule row, then the objects
-- best-effort after commit) keeps every object accounted for. ADR 0071
-- decision 9's "a schedule deleted between dispatch and render completes
-- with no row" still holds: the render job reads the schedule row first
-- (RLS-scoped), so a deleted schedule is simply absent to it.
--
-- Forward-only and idempotent (AGENTS.md §4.4): CREATE TABLE / CREATE INDEX
-- are IF NOT EXISTS, ADD COLUMN is IF NOT EXISTS, ENABLE and FORCE
-- re-asserted are no-ops, and the policy is DROP POLICY IF EXISTS then
-- CREATE. No CREATE INDEX CONCURRENTLY: it cannot run inside a transaction
-- block and the drizzle migrator wraps every file. No SET LOCAL
-- lock_timeout on the new table (nothing else holds a lock on it); the
-- `ALTER TABLE bms.report_files ADD COLUMN` is a metadata-only change (no
-- default, no NOT NULL, no rewrite) so it needs none either.
--
-- No `timezone` CHECK (E4.1b's reasoning, `adminLocationDtoSchema.timezone`:
-- the valid set is a view, not a fixed vocabulary); no `template_id` CHECK
-- (`0077`'s reasoning: the API's literal schema is the single point that
-- would otherwise need to grow in two places).

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  name text NOT NULL,
  template_id text NOT NULL,
  formats text[] NOT NULL,
  cadence text NOT NULL,
  run_at_local time(0) NOT NULL,
  timezone varchar(64) NOT NULL,
  location_ids uuid[] NOT NULL DEFAULT '{}',
  channel_id uuid REFERENCES bms.notification_channels(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT report_schedules_formats_check CHECK (cardinality(formats) > 0 AND formats <@ ARRAY['pdf','xlsx']::text[]),
  CONSTRAINT report_schedules_cadence_check CHECK (cadence IN ('daily','weekly','monthly')),
  CONSTRAINT report_schedules_run_at_minute_check CHECK (extract(second FROM run_at_local) = 0)
);

-- Served read: the tick's "which rows are due" scan (F3.5b plan R-9/R-17,
-- `ReportDispatchService.tick`).
CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON bms.report_schedules (next_run_at) WHERE enabled;

-- Served read: "an organization's report schedules, newest first" (the list
-- route, F3.5b plan R-12), the `0077`/`report_files_org_created_idx` shape.
CREATE INDEX IF NOT EXISTS report_schedules_org_created_idx
  ON bms.report_schedules (organization_id, created_at DESC);

ALTER TABLE bms.report_schedules ENABLE ROW LEVEL SECURITY;

-- ENABLE alone exempts the table owner, and `bms_owner` IS the owner — so
-- without FORCE the policy is decorative for the one role that matters (the
-- `F4.16` defect ADR 0045 exists for).
ALTER TABLE bms.report_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.report_schedules;
CREATE POLICY tenant_isolation ON bms.report_schedules
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

-- `bms.report_files` gains its schedule column and the two indexes it needs
-- (F3.5a plan R-8; F3.5b plan §3 Unit 2). Metadata-only ALTER: nullable, no
-- default, no rewrite.
ALTER TABLE bms.report_files ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES bms.report_schedules(id);

-- The render job's idempotency row (F3.5b plan R-9): a retry that already
-- wrote this schedule's file for this period and format skips the write
-- rather than duplicating it. Partial — an on-demand save (`schedule_id
-- NULL`) is unconstrained, exactly as before this migration.
CREATE UNIQUE INDEX IF NOT EXISTS report_files_schedule_period_format_key ON bms.report_files (schedule_id, period_end, format) WHERE schedule_id IS NOT NULL;

-- The prune read (F3.5b plan R-9: "newest first, offset the retention
-- count"). Partial for the same reason as the index above.
CREATE INDEX IF NOT EXISTS report_files_schedule_created_idx ON bms.report_files (schedule_id, created_at DESC) WHERE schedule_id IS NOT NULL;

COMMENT ON COLUMN bms.report_schedules.location_ids IS
  '{} = whole organization; resolved to asset ids under RLS at render time (ADR 0071 decision 7).';
COMMENT ON COLUMN bms.report_files.schedule_id IS
  'NULL = an on-demand save (ADR 0071 decision 4).';

RESET ROLE;
