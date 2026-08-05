-- ADR 0015 — asset template schema (backlog F2.1).
--
-- One row per template *version*: `(organization_id, code, version)` is the
-- identity, and `bms.assets.template_id` pins the exact version an asset was
-- built from. Publishing v2 therefore cannot mutate assets built from v1,
-- which is the whole point — `asset_points` rows are physical wiring that
-- `apps/ingest` and the rule engine read.
--
-- Additive only: two new tables and one nullable column. No backfill, no
-- NOT NULL on an existing populated column, no DROP. Forward-only (§4.4).
--
-- Indexed 0024, not 0023 as ADR 0015's "Migration safety" section states. That
-- section was written when the journal ended at idx 22; ADR 0018 has since
-- taken idx 23 (`when: 1779062400000`). `when` here is strictly greater, or
-- drizzle applies nothing and every check downstream passes against a schema
-- that is short two tables.

CREATE TABLE IF NOT EXISTS bms.asset_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  code            varchar(64) NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  name            varchar(255) NOT NULL,
  asset_type      varchar(64) NOT NULL,
  domain          varchar(64) NOT NULL,
  description     text,
  status          varchar(32) NOT NULL DEFAULT 'draft',
  content         jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at    timestamptz,
  archived_at     timestamptz,
  created_by      uuid REFERENCES bms.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_templates_org_code_version_unique
  ON bms.asset_templates (organization_id, code, version);

-- At most one editable draft per logical template. The version-bump rule
-- (edit published -> new draft at max(version) + 1) depends on this being
-- enforced by the database: two concurrent "edit" clicks would otherwise
-- create two drafts at the same version and the unique index above would
-- reject the second only by accident of ordering.
CREATE UNIQUE INDEX IF NOT EXISTS asset_templates_org_code_draft_unique
  ON bms.asset_templates (organization_id, code) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS asset_templates_org_status_idx
  ON bms.asset_templates (organization_id, status);

CREATE INDEX IF NOT EXISTS asset_templates_org_asset_type_idx
  ON bms.asset_templates (organization_id, asset_type);

-- `status` mirrors bms.automation_rules.lifecycle_status rather than the
-- ADR 0009 `active` boolean, which cannot express "drafted, not publishable".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'asset_templates_status_check'
       AND conrelid = 'bms.asset_templates'::regclass
  ) THEN
    ALTER TABLE bms.asset_templates
      ADD CONSTRAINT asset_templates_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms.template_points (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id             uuid NOT NULL
                            REFERENCES bms.asset_templates(id) ON DELETE CASCADE,
  point_key               varchar(128) NOT NULL,
  label                   varchar(255),
  unit                    varchar(32),
  kind                    varchar(32) NOT NULL DEFAULT 'measured',
  source_data_key_pattern varchar(128),
  required                boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 0,
  meta                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS template_points_template_point_key_unique
  ON bms.template_points (template_id, point_key);

CREATE INDEX IF NOT EXISTS template_points_template_sort_idx
  ON bms.template_points (template_id, sort_order);

-- `kind` changes instantiation semantics, it is not descriptive metadata: a
-- derived point is computed by the calc engine (F2.6), so F2.2 must NOT emit
-- an asset_points row for it — there is no honest source_data_key for a
-- computed tag, and asset_points.source_data_key is NOT NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'template_points_kind_check'
       AND conrelid = 'bms.template_points'::regclass
  ) THEN
    ALTER TABLE bms.template_points
      ADD CONSTRAINT template_points_kind_check
      CHECK (kind IN ('measured', 'derived'));
  END IF;
END $$;

-- The version pin. NULL means hand-created, which every currently seeded asset
-- is. Ships here rather than in F2.2 so instantiation adds no DDL of its own —
-- fewer migration-bearing jobs is the point (the journal is a single shared
-- file, so they serialise).
ALTER TABLE bms.assets
  ADD COLUMN IF NOT EXISTS template_id uuid;

-- Constraint names are unique per relation, not per cluster, so the guard must
-- be qualified by conrelid. ADR 0015 wrote this check on conname alone; an
-- unqualified guard makes ADD CONSTRAINT a silent no-op the moment any other
-- table carries a same-named constraint. Same lesson as ADR 0018's checks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assets_template_id_asset_templates_id_fk'
       AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets
      ADD CONSTRAINT assets_template_id_asset_templates_id_fk
      FOREIGN KEY (template_id) REFERENCES bms.asset_templates(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assets_template_id_idx ON bms.assets (template_id);
