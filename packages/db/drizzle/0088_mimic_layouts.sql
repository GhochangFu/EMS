-- F3.32c / ADR 0081 decision 1 — the mimic layout library: three tenant tables.
--
-- `bms.mimic_layouts` is one drawn plant per row, unique by (organization_id,
-- slug), with an optimistic `version` a save increments (decision 2).
-- `bms.mimic_layout_nodes` holds its units, panels and labels; a node's id
-- regenerates on every save, so nothing outside the layout refers to one (plan
-- D5). `bms.mimic_layout_pipes` joins two units of the same layout.
--
-- The grid literals below (canvas 20..240 x 20..160, box inside 240 x 160,
-- z 0..100) restate `MIMIC_LAYOUT_BOUNDS` in
-- `packages/shared/src/contracts/mimic-layouts.ts`, and the symbol list
-- restates `mimicSymbolSchema` in its order (plan D4, ADR 0081 decision 1):
-- `tests/f3.32c-mimic-layouts-schema.test.ts` compares both. Containment in
-- the layout's own canvas is the write body's refine, not a CHECK — a CHECK
-- cannot read the parent row.
--
-- `role_code` is nullable: a unit with no role is a passive unit (Discharge),
-- drawn with no status and no values (plan D6). Panels and labels carry none.
--
-- A pipe's ends must be units (plan D7). The three-column foreign keys
-- (layout_id, node_id, kind) -> nodes (layout_id, id, kind) hold both ends in
-- the pipe's own layout, and `_ends_are_units_check` pins the kind columns to
-- 'unit', so a pipe to a panel or a label has no node to reference.
--
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (bms_app), so the tables
-- are created as bms_owner inside SET ROLE / RESET ROLE and no GRANT is
-- written: 0041's default privileges grant them (the 0082 shape).
--
-- Each policy carries the row's own organization_id plus one EXISTS leg per
-- organization-bearing foreign key, in USING and in WITH CHECK: Postgres runs a
-- foreign-key check with row security off, so without a leg a tenant could
-- attach its row to another organization's layout or node (F3.1a, 0050).
-- `bms.asset_roles` and `bms.users` are global, so they carry no leg.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.mimic_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  name varchar(120) NOT NULL,
  slug varchar(64) NOT NULL,
  canvas_w integer NOT NULL,
  canvas_h integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mimic_layouts_organization_slug_key UNIQUE (organization_id, slug),
  CONSTRAINT mimic_layouts_canvas_check CHECK (canvas_w BETWEEN 20 AND 240 AND canvas_h BETWEEN 20 AND 160),
  CONSTRAINT mimic_layouts_version_check CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS bms.mimic_layout_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  layout_id uuid NOT NULL REFERENCES bms.mimic_layouts(id) ON DELETE CASCADE,
  key varchar(32) NOT NULL,
  kind varchar(16) NOT NULL,
  symbol varchar(32),
  label varchar(64) NOT NULL,
  role_code varchar(64) REFERENCES bms.asset_roles(code),
  tone varchar(16),
  x integer NOT NULL,
  y integer NOT NULL,
  w integer NOT NULL,
  h integer NOT NULL,
  z integer NOT NULL DEFAULT 0,
  CONSTRAINT mimic_layout_nodes_layout_key_key UNIQUE (layout_id, key),
  CONSTRAINT mimic_layout_nodes_layout_id_kind_key UNIQUE (layout_id, id, kind),
  CONSTRAINT mimic_layout_nodes_kind_check CHECK (kind IN ('unit', 'panel', 'label')),
  CONSTRAINT mimic_layout_nodes_symbol_check CHECK (symbol IS NULL OR symbol IN ('tank', 'clarifier', 'membrane', 'vessel', 'tower', 'aeration', 'dosing', 'pump', 'discharge', 'valve', 'filter', 'unit')),
  CONSTRAINT mimic_layout_nodes_tone_check CHECK (tone IS NULL OR tone IN ('info', 'neutral', 'accent')),
  CONSTRAINT mimic_layout_nodes_kind_fields_check CHECK (
    (kind = 'unit' AND symbol IS NOT NULL AND tone IS NULL)
    OR (kind = 'panel' AND symbol IS NULL AND role_code IS NULL AND tone IS NOT NULL)
    OR (kind = 'label' AND symbol IS NULL AND role_code IS NULL AND tone IS NULL)
  ),
  CONSTRAINT mimic_layout_nodes_box_check CHECK (x >= 0 AND y >= 0 AND w >= 1 AND h >= 1 AND x + w <= 240 AND y + h <= 160 AND z BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS mimic_layout_nodes_layout_idx ON bms.mimic_layout_nodes (layout_id, z, y, x);

CREATE TABLE IF NOT EXISTS bms.mimic_layout_pipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  layout_id uuid NOT NULL REFERENCES bms.mimic_layouts(id) ON DELETE CASCADE,
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  from_kind varchar(16) NOT NULL DEFAULT 'unit',
  to_kind varchar(16) NOT NULL DEFAULT 'unit',
  CONSTRAINT mimic_layout_pipes_from_fkey FOREIGN KEY (layout_id, from_node_id, from_kind)
    REFERENCES bms.mimic_layout_nodes (layout_id, id, kind) ON DELETE CASCADE,
  CONSTRAINT mimic_layout_pipes_to_fkey FOREIGN KEY (layout_id, to_node_id, to_kind)
    REFERENCES bms.mimic_layout_nodes (layout_id, id, kind) ON DELETE CASCADE,
  CONSTRAINT mimic_layout_pipes_ends_are_units_check CHECK (from_kind = 'unit' AND to_kind = 'unit'),
  CONSTRAINT mimic_layout_pipes_not_self_check CHECK (from_node_id <> to_node_id),
  CONSTRAINT mimic_layout_pipes_layout_ends_key UNIQUE (layout_id, from_node_id, to_node_id)
);

-- The `_layout_ends_key` index serves the from-end cascade (its prefix is
-- (layout_id, from_node_id)); this one serves the to-end cascade, which a save
-- fires once per deleted node.
CREATE INDEX IF NOT EXISTS mimic_layout_pipes_to_idx ON bms.mimic_layout_pipes (layout_id, to_node_id);

ALTER TABLE bms.mimic_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_layouts FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_layout_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_layout_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_layout_pipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_layout_pipes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_layouts;
CREATE POLICY tenant_isolation ON bms.mimic_layouts
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_layout_nodes;
CREATE POLICY tenant_isolation ON bms.mimic_layout_nodes
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_layouts l
             WHERE l.id = mimic_layout_nodes.layout_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_layouts l
             WHERE l.id = mimic_layout_nodes.layout_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_layout_pipes;
CREATE POLICY tenant_isolation ON bms.mimic_layout_pipes
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_layouts l
             WHERE l.id = mimic_layout_pipes.layout_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.mimic_layout_nodes fn
             WHERE fn.id = mimic_layout_pipes.from_node_id
               AND fn.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.mimic_layout_nodes tn
             WHERE tn.id = mimic_layout_pipes.to_node_id
               AND tn.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_layouts l
             WHERE l.id = mimic_layout_pipes.layout_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.mimic_layout_nodes fn
             WHERE fn.id = mimic_layout_pipes.from_node_id
               AND fn.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.mimic_layout_nodes tn
             WHERE tn.id = mimic_layout_pipes.to_node_id
               AND tn.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

COMMENT ON TABLE bms.mimic_layouts IS 'A drawn plant mimic, one per organization slug (ADR 0081 decision 1).';

RESET ROLE;
