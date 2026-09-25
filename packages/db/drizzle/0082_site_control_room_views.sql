-- F3.67 / ADR 0076 decisions 3–4 — the per-site Control Room view setting.
--
-- At most one row per site (location_id is the primary key). No row means the
-- generated view. `kind` names the view:
--   'generated' — the generated site view (F3.68);
--   'dashboard' — a chosen dashboard (dashboard_id);
--   'builtin'   — a hand-built view the code ships (builtin_key; 'smoc' only).
--
-- `dashboard_id` is ON DELETE SET NULL, and its CHECK is one-way
-- (dashboard_id IS NULL OR kind = 'dashboard'): a removed dashboard leaves
-- (kind='dashboard', dashboard_id=NULL), which the resolver answers as the
-- generated view with the `dashboard_removed` notice (plan D1). RESTRICT would
-- make a dashboard delete fail; CASCADE would lose the evidence the notice
-- needs. The builtin pair stays two-way.
--
-- `kind` and `builtin_key` are CHECKs, not a lookup table (ADR 0076 decision 4).
--
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (bms_app), so the table
-- is created as bms_owner inside SET ROLE / RESET ROLE and writes no GRANT:
-- 0041's default privileges grant it (the 0078_report_schedules.sql shape).
--
-- The policy carries two foreign-row legs, the 0073_asset_default_dashboards
-- shape: Postgres runs foreign-key checks with row security off, so without a
-- leg a tenant could point its row at another organization's location or
-- dashboard. The service enforces the same-organization rule first; the policy
-- is the backstop (plan D2). No index beyond the primary key (plan D7).

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.site_control_room_views (
  location_id uuid PRIMARY KEY REFERENCES bms.locations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  kind text NOT NULL,
  dashboard_id uuid REFERENCES bms.dashboards(id) ON DELETE SET NULL,
  builtin_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES bms.users(id),
  CONSTRAINT site_control_room_views_kind_check CHECK (kind IN ('generated', 'dashboard', 'builtin')),
  CONSTRAINT site_control_room_views_builtin_key_check CHECK (builtin_key IS NULL OR builtin_key IN ('smoc')),
  CONSTRAINT site_control_room_views_dashboard_id_check CHECK (dashboard_id IS NULL OR kind = 'dashboard'),
  CONSTRAINT site_control_room_views_builtin_pair_check CHECK ((kind = 'builtin') = (builtin_key IS NOT NULL))
);

ALTER TABLE bms.site_control_room_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.site_control_room_views FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.site_control_room_views;
CREATE POLICY tenant_isolation ON bms.site_control_room_views
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = site_control_room_views.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND (dashboard_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboards d
             WHERE d.id = site_control_room_views.dashboard_id
               AND d.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = site_control_room_views.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND (dashboard_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboards d
             WHERE d.id = site_control_room_views.dashboard_id
               AND d.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  );

COMMENT ON TABLE bms.site_control_room_views IS 'No row = the generated view (ADR 0076 decision 3).';

RESET ROLE;
