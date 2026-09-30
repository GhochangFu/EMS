-- F3.73 / ADR 0087 Amendment 1 (ruling Q1) — dashboard tabs.
--
-- `bms.dashboard_tabs` holds the named tabs of one dashboard; a tab optionally
-- binds one asset group (a domain tab) or none (the Overview). A widget gains
-- `tab_id`; NULL keeps today's single canvas, so every existing dashboard is
-- untouched by this file.
--
-- THE SAME-SITE RULE LIVES IN THE DATABASE (ruling Q1). A tab's group must sit
-- at its dashboard's site. The tab carries `location_id`, and two composite
-- foreign keys pin it from both sides:
--
--   - `(asset_group_id, location_id) -> asset_groups(id, location_id)`: the
--     group is at that location. ON DELETE RESTRICT: deleting a group a tab
--     binds fails loudly rather than turning a domain tab into an Overview.
--   - `(dashboard_id, location_id) -> dashboards(id, location_id)`: the
--     dashboard is at that location. ON UPDATE is the default NO ACTION, so a
--     later PATCH of the dashboard's scope (another site, org-wide, or an
--     asset-group scope — each changes or clears `location_id`) fails 23503,
--     which the service translates to 400 by this constraint's name.
--
-- AN OVERVIEW TAB STORES `location_id NULL` (plan D1). Both composite FKs are
-- MATCH SIMPLE, so a NULL column makes them inert: a dashboard whose only tab
-- is an Overview can still move scope. `dashboard_tabs_group_location_check`
-- ties the two columns together, so a tab cannot carry one without the other.
-- The plain `dashboard_id` FK stays, because the composite one is inert on an
-- Overview tab and a tab must never outlive its dashboard.
--
-- The composite FKs need `(id, location_id)` to be unique on both parents.
-- `id` is already each table's primary key, so the two new keys can never
-- refuse a row; they exist only as FK targets. Added as named constraints in
-- `DO` guards (no `ADD CONSTRAINT IF NOT EXISTS` in Postgres), so drizzle's
-- `unique("...")` mirrors a real constraint.
--
-- `dashboard_widgets.tab_id` has the composite FK `(dashboard_id, tab_id) ->
-- dashboard_tabs(dashboard_id, id)`, which is why `UNIQUE (dashboard_id, id)`
-- exists on the tabs table: a widget can only name a tab of its own dashboard.
-- ON DELETE CASCADE: removing a tab removes its widgets (the service deletes
-- them first so the audit count is honest; this is the backstop).
--
-- `tab_key` is a lower-case slug and never `assets`: the site page owns the
-- `assets` tab, and a dashboard tab of that key would shadow it in the URL.
--
-- POLICY. `organization_id NOT NULL`, strict form, no NULL disjunct (the 0050
-- rule). Two foreign-row legs, the 0073 / 0082 shape: Postgres runs
-- foreign-key checks with row security OFF (0050's security review proved it on
-- the running stack), so without a leg a tenant could hang its tab on another
-- organization's dashboard or bind another organization's group. The group leg
-- is `IS NULL OR EXISTS` so an Overview tab is still gated by the own-column
-- check and cannot fail open. No location leg: the composite FK pins the tab's
-- location to its dashboard's, and the dashboards leg pins that dashboard to
-- this organization.
--
-- `bms.dashboard_widgets`'s policy is NOT re-created. The composite FK pins a
-- widget's tab to the widget's own dashboard, and the existing policy already
-- checks that dashboard's organization, so a tab leg would re-check a fact the
-- FK already holds (plan D1; security review OQ5 is asked to confirm).
--
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (bms_app), so the table
-- is created as bms_owner inside SET ROLE / RESET ROLE and writes no GRANT:
-- 0041's default privileges grant it (0050's header gives the reason in full).
--
-- Forward-only and idempotent: IF NOT EXISTS on the table, column and indexes,
-- `DO` guards on every added constraint, DROP POLICY IF EXISTS then CREATE. No
-- CREATE INDEX CONCURRENTLY: the drizzle migrator wraps every file in a
-- transaction. Indexed 0094, journal `when` strictly greater than 0093's
-- 1790731287289.

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_groups_id_location_key') THEN
    ALTER TABLE bms.asset_groups ADD CONSTRAINT asset_groups_id_location_key UNIQUE (id, location_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboards_id_location_key') THEN
    ALTER TABLE bms.dashboards ADD CONSTRAINT dashboards_id_location_key UNIQUE (id, location_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms.dashboard_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  dashboard_id uuid NOT NULL,
  location_id uuid,
  asset_group_id uuid,
  tab_key varchar(64) NOT NULL,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_tabs_dashboard_id_fkey FOREIGN KEY (dashboard_id) REFERENCES bms.dashboards(id) ON DELETE CASCADE,
  CONSTRAINT dashboard_tabs_dashboard_id_location_id_fkey FOREIGN KEY (dashboard_id, location_id) REFERENCES bms.dashboards(id, location_id) ON DELETE CASCADE,
  CONSTRAINT dashboard_tabs_asset_group_id_location_id_fkey FOREIGN KEY (asset_group_id, location_id) REFERENCES bms.asset_groups(id, location_id) ON DELETE RESTRICT,
  CONSTRAINT dashboard_tabs_dashboard_id_tab_key_key UNIQUE (dashboard_id, tab_key),
  CONSTRAINT dashboard_tabs_dashboard_id_id_key UNIQUE (dashboard_id, id),
  CONSTRAINT dashboard_tabs_group_location_check CHECK ((asset_group_id IS NULL) = (location_id IS NULL)),
  CONSTRAINT dashboard_tabs_tab_key_check CHECK (tab_key ~ '^[a-z0-9-]{1,64}$' AND tab_key <> 'assets')
);

-- The tab strip read (`ORDER BY sort_order` per dashboard). The
-- `(dashboard_id, tab_key)` and `(dashboard_id, id)` keys lead with the same
-- column but do not serve the sort.
CREATE INDEX IF NOT EXISTS dashboard_tabs_dashboard_idx ON bms.dashboard_tabs (dashboard_id, sort_order);
-- Serves the RESTRICT check on an asset-group delete.
CREATE INDEX IF NOT EXISTS dashboard_tabs_asset_group_idx ON bms.dashboard_tabs (asset_group_id);

ALTER TABLE bms.dashboard_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.dashboard_tabs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.dashboard_tabs;
CREATE POLICY tenant_isolation ON bms.dashboard_tabs
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.dashboards d
             WHERE d.id = dashboard_tabs.dashboard_id
               AND d.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND (asset_group_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = dashboard_tabs.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.dashboards d
             WHERE d.id = dashboard_tabs.dashboard_id
               AND d.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND (asset_group_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = dashboard_tabs.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  );

ALTER TABLE bms.dashboard_widgets ADD COLUMN IF NOT EXISTS tab_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_widgets_dashboard_id_tab_id_fkey') THEN
    ALTER TABLE bms.dashboard_widgets
      ADD CONSTRAINT dashboard_widgets_dashboard_id_tab_id_fkey FOREIGN KEY (dashboard_id, tab_id) REFERENCES bms.dashboard_tabs(dashboard_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- Serves the cascade from a tab delete and the per-tab widget read.
CREATE INDEX IF NOT EXISTS dashboard_widgets_tab_idx ON bms.dashboard_widgets (tab_id);

COMMENT ON TABLE bms.dashboard_tabs IS 'Named tabs of one dashboard; asset_group_id NULL = the Overview (ADR 0087 Amendment 1).';

RESET ROLE;
