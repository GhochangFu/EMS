-- F3.5a — `bms.report_files` — ADR 0071 decision 4.
--
-- One table: the row that pairs a fixed key in the bucket
-- (`org/<organizationId>/reports/<fileId>`, built once by
-- `apps/api/src/storage/object-key.ts`'s `buildReportObjectKey`, decision 5)
-- with the tenant metadata a read route needs. The bytes live in MinIO/S3;
-- this table never stores them.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING HERE, NOT CEREMONIAL (ADR 0045
-- decision 6, `0050`'s header, `0072`'s header). It matters twice. First,
-- `FORCE ROW LEVEL SECURITY` requires table ownership. Second, and easier to
-- miss: `0041_bms_owner_and_force_rls` lines 112-119 set `ALTER DEFAULT
-- PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE,
-- DELETE ON TABLES TO bms_tenant, bms_fleet`, and default privileges apply
-- only to objects created by the role they name. `pnpm db:migrate` connects
-- as DATABASE_URL_SUPERUSER (`bms_app`). Without the SET ROLE this table
-- would be owned by `bms_app`, the default privileges would not fire, and no
-- pool role could reach it.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it. A hand-written GRANT here would be redundant
-- and would hide a future breakage of the SET ROLE bracket.
--
-- `RESET ROLE;` is mandatory, not symmetry: `0041`'s comment records that a
-- leaked SET ROLE reaches the drizzle migrator's own journal write and every
-- later migration in the same run.
--
-- POLICY SHAPE — the own-column strict form, `0072`'s exception rather than
-- its rule. `0072`'s `bms.asset_images` needed an EXISTS leg against
-- `bms.assets` because `asset_id` names a real parent row whose own
-- `organization_id` could disagree with the child's. This table has no such
-- parent: `location_ids` is an array of location ids used only to bound the
-- readers' scope at read time (checked in the service, R-5 of the F3.5a
-- plan), not a foreign key, so there is nothing for an EXISTS leg to guard.
-- The policy therefore checks only the own `organization_id` column, in
-- `USING` and in `WITH CHECK`, with no NULL disjunct — `bms.organizations.id`
-- is NOT NULL on this row (`organization_id uuid NOT NULL`), so there is no
-- legitimate fleet-owned row here, exactly `0072`'s reasoning for
-- `asset_images`.
--
-- `created_by` IS NOT POLICY-CHECKED, and that is deliberate, not an
-- oversight: `bms.users.organization_id` is permanently nullable (a global
-- admin belongs to no organization), so an EXISTS leg on `created_by` would
-- refuse every row a global admin saves. The column exists for audit/
-- attribution only; it carries no isolation weight and none is claimed for
-- it.
--
-- `current_setting('app.current_organization', true)` returns NULL rather
-- than erroring when the GUC is unset, so a connection with no tenant fails
-- closed and quiet.
--
-- NO `schedule_id`, NO `template_id` CHECK, deliberately (F3.5a plan §3 Unit
-- 4): `schedule_id` and the `(schedule_id, period_end, format)` unique index
-- belong to migration `0078` (`F3.5b`, ADR 0071 decision 4/9) alongside
-- `bms.report_schedules` itself — a nullable FK to a table that does not yet
-- exist cannot be written today. `template_id` has no CHECK because the
-- ADR names its vocabulary as extensible; the API's literal schema
-- (`reportTemplateIdSchema`, derived from `energyReportTemplateSchema`) is
-- the single point that would otherwise need to grow in two places.
--
-- Forward-only and idempotent (AGENTS.md §4.4): CREATE TABLE / CREATE INDEX
-- are IF NOT EXISTS, ENABLE and FORCE re-asserted are no-ops, and the policy
-- is DROP POLICY IF EXISTS then CREATE. No CREATE INDEX CONCURRENTLY: it
-- cannot run inside a transaction block and the drizzle migrator wraps every
-- file. No SET LOCAL lock_timeout: the table is new, so nothing else holds a
-- lock on it.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.report_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  template_id text NOT NULL,
  format text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  location_ids uuid[] NOT NULL DEFAULT '{}',
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 char(64) NOT NULL,
  filename text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'none',
  delivery_error text,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_files_object_key_key UNIQUE (object_key),
  CONSTRAINT report_files_format_check CHECK (format IN ('pdf', 'xlsx')),
  CONSTRAINT report_files_delivery_status_check CHECK (delivery_status IN ('none', 'sent', 'skipped_unconfigured', 'failed')),
  CONSTRAINT report_files_byte_size_check CHECK (byte_size > 0),
  CONSTRAINT report_files_period_check CHECK (period_start <= period_end)
);

-- Served read: "an organization's report files, newest first" (the list
-- route, R-7).
CREATE INDEX IF NOT EXISTS report_files_org_created_idx
  ON bms.report_files (organization_id, created_at DESC);

ALTER TABLE bms.report_files ENABLE ROW LEVEL SECURITY;

-- ENABLE alone exempts the table owner, and `bms_owner` IS the owner — so
-- without FORCE the policy is decorative for the one role that matters (the
-- `F4.16` defect ADR 0045 exists for).
ALTER TABLE bms.report_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.report_files;
CREATE POLICY tenant_isolation ON bms.report_files
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

COMMENT ON COLUMN bms.report_files.location_ids IS
  '{} = whole organization; the readers'' scope snapshot (ADR 0071 decision 4).';

RESET ROLE;
