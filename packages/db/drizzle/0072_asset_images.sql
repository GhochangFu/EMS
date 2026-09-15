-- F3.3 — object storage on the S3 API, `bms.asset_images` — ADR 0066 decision 5.
--
-- One table: the row that pairs a fixed key in the bucket
-- (`org/<organizationId>/assets/<assetId>/<imageId>`, built once by
-- `apps/api/src/storage/object-key.ts`, decision 4) with the tenant metadata a
-- read route needs. The bytes live in MinIO/S3; this table never stores them.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING HERE, NOT CEREMONIAL (ADR 0045
-- decision 6, `0050`'s header). It matters twice. First, `FORCE ROW LEVEL
-- SECURITY` requires table ownership. Second, and easier to miss:
-- `0041_bms_owner_and_force_rls` lines 112-119 set `ALTER DEFAULT PRIVILEGES
-- FOR ROLE bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON
-- TABLES TO bms_tenant, bms_fleet`, and default privileges apply only to
-- objects created by the role they name. `pnpm db:migrate` connects as
-- DATABASE_URL_SUPERUSER (`bms_app`). Without the SET ROLE this table would be
-- owned by `bms_app`, the default privileges would not fire, and no pool role
-- could reach it — the failure `0039`'s own comment records as surfacing "one
-- endpoint at a time", inside `F3.4`, long after this migration ran.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it. A hand-written GRANT here would be redundant
-- and would hide a future breakage of the SET ROLE bracket.
--
-- `RESET ROLE;` is mandatory, not symmetry: `0041`'s comment records that a
-- leaked SET ROLE reaches the drizzle migrator's own journal write and every
-- later migration in the same run.
--
-- POLICY SHAPE — the `0050`/`0047` §3c idiom, not the own-column-only shape.
-- `organization_id` is denormalised onto this row (fast reads, no join for the
-- common case) AND `asset_id` names a real parent (`bms.assets`) whose own
-- `organization_id` can disagree with this row's if nothing checks it.
-- Postgres runs a referential-integrity check with row security OFF, so the
-- `asset_id` foreign key alone never consults `bms.assets`' policy — `0050`'s
-- own security review proved exactly this gap on the running stack for a
-- structurally identical pair of columns. So the policy checks BOTH: the own
-- `organization_id` column, in `USING` and in `WITH CHECK`, AND an `EXISTS`
-- against `bms.assets` confirming the referenced asset belongs to the same
-- organization. Written explicitly (`a.organization_id = <current org>`)
-- rather than leaning on `bms.assets`' own policy to filter the subquery —
-- `0047` §3c's rule, and what makes this correct under `bms_owner`, which is
-- FORCE-bound but filtered differently from `bms_tenant`.
--
-- `bms.assets.organization_id` is NOT NULL (migration `0047`), so — like
-- `0050`'s three tables — there is no legitimate fleet-owned row here and the
-- policy is the STRICT form with no NULL disjunct.
--
-- `created_by` IS NOT POLICY-CHECKED, and that is deliberate, not an
-- oversight: `bms.users.organization_id` is permanently nullable (a global
-- admin belongs to no organization, `bms-schema.ts:47-51`), so an EXISTS leg
-- on `created_by` would refuse every row a global admin uploads. The column
-- exists for audit/attribution only; it carries no isolation weight and none
-- is claimed for it.
--
-- `current_setting('app.current_organization', true)` returns NULL rather
-- than erroring when the GUC is unset, so a connection with no tenant fails
-- closed and quiet.
--
-- NOT EXTENDED, DELIBERATELY: `TENANT_TABLES` in
-- `tests/adr-0043-tenant-columns.test.ts`. That constant is the set of tables
-- `E7.1b` gave `organization_id` to via migrations `0046`/`0047`, and every
-- assertion built on it scans those two files specifically. Adding
-- `asset_images` would assert that `0046`/`0047` backfilled a table that did
-- not exist on 2026-08-26 — red for the wrong reason. This table is
-- tenant-scoped from birth instead (ADR 0043/0045's preferred order).
--
-- `asset_images_content_type_check` closes the content-type vocabulary to the
-- three MIME types ADR 0066 decision 7 accepts (Q-E, §4.8's rule for a closed
-- `z.enum` that is stored: `dashboard_widgets_widget_type_check` is the
-- precedent). The same three strings live in
-- `@bms/shared/contracts/asset-images.ts`'s `assetImageContentTypeSchema`;
-- drift between the two is the `F4.43` failure — a value the database accepts
-- that no handler was built to serve.
--
-- Forward-only and idempotent (AGENTS.md §4.4): CREATE TABLE / CREATE INDEX
-- are IF NOT EXISTS, ENABLE and FORCE re-asserted are no-ops, and the policy
-- is DROP POLICY IF EXISTS then CREATE. No CREATE INDEX CONCURRENTLY: it
-- cannot run inside a transaction block and the drizzle migrator wraps every
-- file. No SET LOCAL lock_timeout: the table is new, so nothing else holds a
-- lock on it.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.asset_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  asset_id uuid NOT NULL REFERENCES bms.assets(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 char(64) NOT NULL,
  original_filename text NOT NULL,
  caption text,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_images_object_key_key UNIQUE (object_key),
  CONSTRAINT asset_images_byte_size_check CHECK (byte_size > 0),
  CONSTRAINT asset_images_content_type_check CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

-- Served read: "an asset's images, newest first" (the list route, decision 4).
CREATE INDEX IF NOT EXISTS asset_images_asset_created_idx
  ON bms.asset_images (asset_id, created_at DESC);

ALTER TABLE bms.asset_images ENABLE ROW LEVEL SECURITY;

-- ENABLE alone exempts the table owner, and `bms_owner` IS the owner — so
-- without FORCE the policy is decorative for the one role that matters. That
-- is the exact defect ADR 0045 exists for: `F4.16`'s FORCE was a no-op while
-- `bms_app` owned the schema.
ALTER TABLE bms.asset_images FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.asset_images;
CREATE POLICY tenant_isolation ON bms.asset_images
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.assets a WHERE a.id = asset_images.asset_id
      AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.assets a WHERE a.id = asset_images.asset_id
      AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

RESET ROLE;
