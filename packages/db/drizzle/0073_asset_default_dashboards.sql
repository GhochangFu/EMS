-- F3.2 / ADR 0067 decision 1 — `bms.dashboards` gains an asset scope and an
-- asset-template stamp.
--
-- Two nullable columns, `0056`'s idiom exactly:
--
--   - `asset_id uuid REFERENCES bms.assets(id) ON DELETE CASCADE`. CASCADE,
--     UNLIKE `template_id`. A section-template instance outlives its
--     template (the stamp is provenance, and a delete that would orphan it
--     must fail loudly). A per-asset default dashboard is ABOUT one asset and
--     has no meaning without it — keeping it after the asset is gone would
--     leave a dashboard whose every binding cascaded away already
--     (`dashboard_widget_points.point_id … ON DELETE CASCADE`).
--   - `asset_template_id uuid REFERENCES bms.asset_templates(id)`, no
--     `ON DELETE`, mirroring `template_id` exactly: it points at the VERSION
--     ROW whose identity is `(organization_id, code, version)`, so there is
--     no second `asset_template_version` column (ADR 0049 decision 2's
--     reasoning, verbatim).
--
-- Three constraints:
--
--   - `dashboards_scope_check` is REPLACED: at most one of `location_id`,
--     `asset_group_id`, `asset_id` is non-null. Written as a COUNT of
--     non-nulls `<= 1`, not as three pairwise `NOT (a AND b)` clauses, so a
--     fourth scope is one more term rather than three more clauses.
--   - `dashboards_template_stamp_check`: `NOT (template_id IS NOT NULL AND
--     asset_template_id IS NOT NULL)`. A dashboard came from one template or
--     none.
--   - `dashboards_asset_stamp_check`: `asset_template_id IS NULL OR
--     asset_id IS NOT NULL`. A stamp without an asset describes nothing.
--
-- `tenant_isolation` on `bms.dashboards` is RE-CREATED to check both new
-- parents, exactly as migration `0056` did for `template_id`, for the reason
-- `0050`'s security review PROVED on the running stack: Postgres runs
-- referential-integrity checks with row security OFF, so a foreign key never
-- consults the parent's policy, and an unchecked `asset_id` (or
-- `asset_template_id`) would let a tenant stamp its dashboard with another
-- organization's asset (or asset template). The three existing legs
-- (`location_id`, `asset_group_id`, `template_id`) are carried over
-- VERBATIM from `0056`; the two new legs follow the same
-- `IS NULL OR EXISTS(...)` shape, so a NULL column is still gated by the
-- own-column check and cannot fail open.
--
-- Two indexes: `dashboards_asset_idx` serves the cascade and the backfill's
-- skip query (`SELECT DISTINCT asset_id FROM dashboards WHERE
-- asset_template_id IN (...) AND asset_id IN (...)`), `dashboards_asset_template_idx`
-- serves the same skip query's other predicate.
--
-- Forward-only and idempotent. Indexed 0073: `0051`-`0072` are committed and
-- frozen, and the journal `when` is strictly greater than `0072`'s
-- 1789451212123, or drizzle applies nothing and every check downstream passes
-- against a schema short two columns (`0024`'s header records this).

SET ROLE bms_owner;

ALTER TABLE bms.dashboards
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES bms.assets(id) ON DELETE CASCADE;

ALTER TABLE bms.dashboards
  ADD COLUMN IF NOT EXISTS asset_template_id uuid REFERENCES bms.asset_templates(id);

CREATE INDEX IF NOT EXISTS dashboards_asset_idx ON bms.dashboards (asset_id);
CREATE INDEX IF NOT EXISTS dashboards_asset_template_idx ON bms.dashboards (asset_template_id);

ALTER TABLE bms.dashboards DROP CONSTRAINT IF EXISTS dashboards_scope_check;
ALTER TABLE bms.dashboards
  ADD CONSTRAINT dashboards_scope_check
  CHECK (
    ((location_id IS NOT NULL)::int + (asset_group_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int) <= 1
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dashboards_template_stamp_check'
       AND conrelid = 'bms.dashboards'::regclass
  ) THEN
    ALTER TABLE bms.dashboards
      ADD CONSTRAINT dashboards_template_stamp_check
      CHECK (NOT (template_id IS NOT NULL AND asset_template_id IS NOT NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dashboards_asset_stamp_check'
       AND conrelid = 'bms.dashboards'::regclass
  ) THEN
    ALTER TABLE bms.dashboards
      ADD CONSTRAINT dashboards_asset_stamp_check
      CHECK (asset_template_id IS NULL OR asset_id IS NOT NULL);
  END IF;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON bms.dashboards;
CREATE POLICY tenant_isolation ON bms.dashboards
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = dashboards.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_group_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = dashboards.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (template_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboard_templates t
             WHERE t.id = dashboards.template_id
               AND t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_id IS NULL OR EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = dashboards.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_template_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_templates at
             WHERE at.id = dashboards.asset_template_id
               AND at.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = dashboards.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_group_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = dashboards.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (template_id IS NULL OR EXISTS (SELECT 1 FROM bms.dashboard_templates t
             WHERE t.id = dashboards.template_id
               AND t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_id IS NULL OR EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = dashboards.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_template_id IS NULL OR EXISTS (SELECT 1 FROM bms.asset_templates at
             WHERE at.id = dashboards.asset_template_id
               AND at.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  );

RESET ROLE;
