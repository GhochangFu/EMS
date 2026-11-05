-- F4.307 / ADR 0081 Amendment 1 - bms.mimic_layout_node_points: the ordered point
-- list of one layout unit (plan section 3, builder call C10).
--
-- A roled unit may list up to MIMIC_HEADLINE_POINTS (3) point-key codes, in order;
-- an empty list keeps the headline rank. One row per listed key: ord 0..2 is the
-- row's place, unique per node, and a key is listed at most once per node. The
-- ord bound restates MIMIC_HEADLINE_POINTS - 1 from
-- packages/shared/src/contracts/mimic.ts; SQL has no imports, so
-- tests/f4.307-mimic-layout-node-points-schema.test.ts compares the two.
--
-- UNITS ONLY, HELD THE PIPES WAY (owner ruling Q1 (a), the 0088 idiom). The
-- composite foreign key (node_id, node_kind) -> mimic_layout_nodes (id, kind) and
-- _unit_check (node_kind = 'unit') leave a list on a panel or a label no node to
-- reference. The nodes table gains UNIQUE (id, kind) first, as the FK's target
-- (guarded: ADD CONSTRAINT has no IF NOT EXISTS). "Roled only" is the write body's
-- refine, because role_code is nullable on a unit.
--
-- A save replaces the whole layout (ADR 0081 decision 2): the nodes are deleted
-- and inserted again with new ids, so the rows cascade with their node
-- (ON DELETE CASCADE) and are inserted again in the same transaction.
-- point_key references bms.point_keys(code) with no ON DELETE: keys are
-- deactivated, never deleted. bms.point_keys is global vocabulary (ADR 0051), so
-- its foreign key carries no policy leg.
--
-- THE POLICY CHECKS ITS ORG-BEARING PARENT, NOT ONLY ITS OWN COLUMN (the 0050 /
-- 0088 shape). Postgres runs a foreign-key check with row security off, so
-- without the EXISTS below a tenant could attach a row stamped with its own
-- organization to another organization's unit. Both halves, USING and WITH
-- CHECK, with no NULL disjunct.
--
-- WHY THIS FILE WRITES NO GRANT. 0041_bms_owner_and_force_rls.sql sets ALTER
-- DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms for bms_tenant and
-- bms_fleet. Default privileges fire only for objects created by the role they
-- name, so the table is created as bms_owner inside SET ROLE / RESET ROLE: created
-- as bms_app it would reach no pool role. The proof block below asserts the
-- privileges arrived; it never writes them. The same sentence is in
-- 0123_calc_backfill_runs.sql.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent. No statement-breakpoint markers (the 0038 reason).

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mimic_layout_nodes_id_kind_key'
      AND conrelid = 'bms.mimic_layout_nodes'::regclass
  ) THEN
    ALTER TABLE bms.mimic_layout_nodes ADD CONSTRAINT mimic_layout_nodes_id_kind_key UNIQUE (id, kind);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms.mimic_layout_node_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  node_id uuid NOT NULL,
  node_kind varchar(16) NOT NULL DEFAULT 'unit',
  point_key varchar(128) NOT NULL REFERENCES bms.point_keys(code),
  ord smallint NOT NULL,
  CONSTRAINT mimic_layout_node_points_node_fkey FOREIGN KEY (node_id, node_kind)
    REFERENCES bms.mimic_layout_nodes (id, kind) ON DELETE CASCADE,
  CONSTRAINT mimic_layout_node_points_unit_check CHECK (node_kind = 'unit'),
  CONSTRAINT mimic_layout_node_points_ord_check CHECK (ord BETWEEN 0 AND 2),
  CONSTRAINT mimic_layout_node_points_node_ord_key UNIQUE (node_id, ord),
  CONSTRAINT mimic_layout_node_points_node_key_key UNIQUE (node_id, point_key)
);

ALTER TABLE bms.mimic_layout_node_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.mimic_layout_node_points FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.mimic_layout_node_points;
CREATE POLICY tenant_isolation ON bms.mimic_layout_node_points
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_layout_nodes n
             WHERE n.id = mimic_layout_node_points.node_id
               AND n.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.mimic_layout_nodes n
             WHERE n.id = mimic_layout_node_points.node_id
               AND n.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

COMMENT ON TABLE bms.mimic_layout_node_points IS 'The ordered point list of one layout unit (ADR 0081 Amendment 1).';

RESET ROLE;

-- The proof, as the migrator's own superuser role (the 0123 idiom): RLS that is
-- not forced, a privilege that did not arrive through 0041's defaults, or a
-- constraint under another name reads correct in this file and guards nothing.
-- has_table_privilege follows role membership (the 0059 reason).
DO $$
DECLARE
  wanted text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'bms'
       AND c.relname = 'mimic_layout_node_points'
       AND c.relrowsecurity
       AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'migration 0124: row level security is not enabled and forced on bms.mimic_layout_node_points';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.mimic_layout_node_points', 'INSERT') THEN
    RAISE EXCEPTION 'migration 0124: bms_tenant holds no INSERT on bms.mimic_layout_node_points';
  END IF;

  IF NOT has_table_privilege('bms_fleet', 'bms.mimic_layout_node_points', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0124: bms_fleet holds no SELECT on bms.mimic_layout_node_points';
  END IF;

  FOREACH wanted IN ARRAY ARRAY[
    'mimic_layout_node_points_node_fkey',
    'mimic_layout_node_points_point_key_fkey',
    'mimic_layout_node_points_ord_check'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = wanted
        AND conrelid = 'bms.mimic_layout_node_points'::regclass
    ) THEN
      RAISE EXCEPTION 'migration 0124: constraint % does not exist on bms.mimic_layout_node_points', wanted;
    END IF;
  END LOOP;
END $$;
