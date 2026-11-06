-- F4.317 / ADR 0112 decisions 2, 3, 4 and 9, and Amendment 1 — the organization Control Room
-- strip's pointer table, its template section, and two CHECK widenings.
--
-- 1. `bms.organization_control_room_views` — at most one row per organization
--    (`organization_id` is the primary key). No row means the stock strip
--    (`organization-standard`, ADR 0112 decision 3): every organization has
--    the strip with no admin action, and no migration, site creation or
--    onboarding step writes a row. A row points at the organization-wide
--    dashboard "Make organization layout" copied from a published
--    `organization` template.
--
--    `dashboard_id` is ON DELETE SET NULL: a removed dashboard leaves the row
--    with a NULL pointer, which the service answers as the stock strip.
--    RESTRICT would make a dashboard delete fail. `organization_id` CASCADEs,
--    the `site_control_room_views.location_id` shape (0082).
--
--    The table is created as `bms_owner` inside SET ROLE / RESET ROLE and
--    writes no GRANT: 0041's default privileges grant it (the 0082 shape).
--
--    The policy carries the own-organization check and one foreign-row leg on
--    `bms.dashboards`, in USING and in WITH CHECK: Postgres runs foreign-key
--    checks with row security off, so without the leg a tenant could point its
--    row at another organization's dashboard. The service enforces the
--    same-organization rule first; the policy is the backstop. No index beyond
--    the primary key.
--
-- 2. One `bms.dashboard_sections` row, `organization` ("Organization layouts",
--    owner ruling Q4), for the NOT NULL `dashboard_templates.section`. Sort 950
--    is past 0095's `site` (900) and the six 0056 rows (110-160); no earlier
--    migration uses it.
--
-- 3. After RESET ROLE, two CHECK widenings by DROP + ADD, the 0096 shape
--    (each constraint already exists, so an IF NOT EXISTS guard would skip the
--    widening and report success):
--    - `dashboard_templates_target_check` gains `organization` (0095 froze
--      `asset_group`, `site`);
--    - `dashboard_widget_sources_catalog_key_check` gains `sites.live.count`,
--      `pue.ratio` and `alarms.critical.count` (0096 froze ten). The third is
--      ADR 0112 Amendment 1 (owner ruling Q1b): tile 3 binds it beside
--      `alarms.active.count`, since UNIQUE (widget_id, catalog_key) (0054)
--      forbids one key twice on a widget.
--    Each list must equal its enum in `packages/shared/src/contracts/`
--    (`dashboardTemplateTargetSchema`, `metricCatalogKeySchema`);
--    `tests/f4.317-organization-control-room-views-schema.test.ts` compares
--    them. Widening is safe in both directions: every stored row passes, and
--    an older `apps/api` never writes the new values. Both tables are bounded,
--    so the validation scan under the ACCESS EXCLUSIVE lock is trivial.
--
-- Forward-only (AGENTS.md §4.4). No statement-breakpoint markers (the 0038
-- reason: drizzle splits on the raw string, even inside a comment).

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.organization_control_room_views (
  organization_id uuid PRIMARY KEY REFERENCES bms.organizations(id) ON DELETE CASCADE,
  dashboard_id uuid REFERENCES bms.dashboards(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES bms.users(id)
);

ALTER TABLE bms.organization_control_room_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.organization_control_room_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.organization_control_room_views;
CREATE POLICY tenant_isolation ON bms.organization_control_room_views
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (dashboard_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboards d
             WHERE d.id = organization_control_room_views.dashboard_id
               AND d.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (dashboard_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboards d
             WHERE d.id = organization_control_room_views.dashboard_id
               AND d.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  );

COMMENT ON TABLE bms.organization_control_room_views IS 'No row = the stock strip (ADR 0112 decision 3).';

INSERT INTO bms.dashboard_sections (code, label, sort_order) VALUES
  ('organization', 'Organization layouts', 950)
ON CONFLICT DO NOTHING;

-- The migration asserts its own effect (the 0095 idiom): ON CONFLICT DO
-- NOTHING is silent by construction and would hide a row that never landed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bms.dashboard_sections WHERE code = 'organization') THEN
    RAISE EXCEPTION 'migration 0126: bms.dashboard_sections has no row for code ''organization''';
  END IF;
END $$;

RESET ROLE;

ALTER TABLE bms.dashboard_templates
  DROP CONSTRAINT IF EXISTS dashboard_templates_target_check;

ALTER TABLE bms.dashboard_templates
  ADD CONSTRAINT dashboard_templates_target_check
  CHECK (target IN ('asset_group', 'site', 'organization'));

ALTER TABLE bms.dashboard_widget_sources
  DROP CONSTRAINT IF EXISTS dashboard_widget_sources_catalog_key_check;

ALTER TABLE bms.dashboard_widget_sources
  ADD CONSTRAINT dashboard_widget_sources_catalog_key_check
  CHECK (catalog_key IN ('alarms.active.count', 'alarms.active', 'workorders.open.count', 'workorders.open', 'assets.health.score', 'sustainability.total', 'sustainability.by_location', 'water.balance', 'assets.offline.count', 'assets.list', 'sites.live.count', 'pue.ratio', 'alarms.critical.count'));
