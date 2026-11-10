-- E7.2 / ADR 0123 decisions 5 and 6 - bms.edge_gateways and bms.rtus.edge_gateway_id
-- (plan docs/plans/e7.2-edge-store-and-forward.md section 6, builder call C8).
--
-- One row per site box. token_hash holds the SHA-256 (32 bytes) of the gateway's
-- bearer token, NULL until the first mint; the token itself is never stored.
-- status is active or revoked (revoke is final). last_seen_at, reported_backlog
-- and clock_state are what the box last told the cloud receiver;
-- backfill_dirty_from / _to is the window the receiver wrote late rows into and
-- the aggregate repair loop has not yet refreshed (decision 11).
--
-- An RTU with edge_gateway_id set has one writer, the edge (decision 6): the
-- cloud binding plan dials nothing for it. NULL keeps today's behaviour, so no
-- row is rewritten and nothing changes until an admin assigns an RTU.
--
-- C8, TIGHTER THAN THE ADR SKETCH (plan P7, ruled yes):
--   edge_gateways_location_id_organization_id_fkey  (location_id, organization_id)
--     -> bms.locations (id, organization_id), the 0113 idiom: a gateway sits in
--     its location's organization. MATCH SIMPLE, so a NULL location skips it.
--     The target locations_id_organization_key exists since 0103.
--   edge_gateways_id_organization_id_key  UNIQUE (id, organization_id). Never
--     refuses a row (id is the primary key); it is only the next key's target.
--   rtus_edge_gateway_id_organization_id_fkey  (edge_gateway_id, organization_id)
--     -> bms.edge_gateways (id, organization_id): an RTU is served only by a
--     gateway of its own organization. The referential check runs with row
--     security off, so a single-column key would let a tenant attach its RTU to
--     another organization's gateway whatever it can see.
--   CHECKs on status, clock_state, octet_length(token_hash) = 32, and the dirty
--     window both-or-neither and ordered; a unique partial index on token_hash
--     (the receiver's lookup key); an index on rtus (edge_gateway_id).
-- All foreign keys are NO ACTION both ways: a gateway is revoked, never deleted.
--
-- THE POLICY. tenant_isolation on organization_id alone, USING and WITH CHECK,
-- no NULL disjunct. The parent rows are held by the composite keys above, so
-- no EXISTS leg is needed. The cloud host reads and updates the table as
-- bms_fleet (BYPASSRLS) and filters by gateway id itself (ADR 0123).
--
-- WHY THIS FILE WRITES NO GRANT. 0041_bms_owner_and_force_rls.sql sets ALTER
-- DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms for bms_tenant and
-- bms_fleet. Default privileges fire only for objects created by the role they
-- name, so the table is created as bms_owner inside SET ROLE / RESET ROLE: created
-- as bms_app it would reach no pool role. The proof block below asserts the
-- privileges arrived; it never writes them. The same sentence is in
-- 0124_mimic_layout_node_points.sql. No new role either: bms_fleet is already a
-- member of bms_rollup with SET (0044), which refreshAggregatesFrom needs; the
-- proof asserts that too, because ADR 0123's "no GRANT, no role" rests on it.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent: the table, column and indexes are IF NOT EXISTS,
-- the policy is dropped before it is created, and the one ADD CONSTRAINT sits
-- behind a pg_constraint probe. No statement-breakpoint markers (the 0038 reason).

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.edge_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  location_id uuid,
  code varchar(64) NOT NULL,
  name varchar(128) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  token_hash bytea,
  token_last4 varchar(4),
  token_rotated_at timestamptz,
  last_seen_at timestamptz,
  reported_backlog integer,
  clock_state varchar(16),
  backfill_dirty_from timestamptz,
  backfill_dirty_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edge_gateways_location_id_organization_id_fkey FOREIGN KEY (location_id, organization_id)
    REFERENCES bms.locations (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT edge_gateways_organization_id_code_key UNIQUE (organization_id, code),
  CONSTRAINT edge_gateways_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT edge_gateways_status_check CHECK (status IN ('active','revoked')),
  CONSTRAINT edge_gateways_clock_state_check CHECK (clock_state IS NULL OR clock_state IN ('synced','unsynced')),
  CONSTRAINT edge_gateways_token_hash_check CHECK (token_hash IS NULL OR octet_length(token_hash) = 32),
  CONSTRAINT edge_gateways_backfill_window_check CHECK (
    (backfill_dirty_from IS NULL) = (backfill_dirty_to IS NULL)
    AND (backfill_dirty_from IS NULL OR backfill_dirty_from <= backfill_dirty_to)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS edge_gateways_token_hash_key
  ON bms.edge_gateways (token_hash) WHERE token_hash IS NOT NULL;

ALTER TABLE bms.edge_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.edge_gateways FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.edge_gateways;
CREATE POLICY tenant_isolation ON bms.edge_gateways
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

COMMENT ON TABLE bms.edge_gateways IS 'One site edge gateway and its uplink token hash (ADR 0123).';

ALTER TABLE bms.rtus ADD COLUMN IF NOT EXISTS edge_gateway_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_edge_gateway_id_organization_id_fkey'
      AND conrelid = 'bms.rtus'::regclass
  ) THEN
    ALTER TABLE bms.rtus ADD CONSTRAINT rtus_edge_gateway_id_organization_id_fkey
      FOREIGN KEY (edge_gateway_id, organization_id)
      REFERENCES bms.edge_gateways (id, organization_id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rtus_edge_gateway_id_idx ON bms.rtus (edge_gateway_id);

RESET ROLE;

-- The proof, as the migrator's own superuser role (the 0123 / 0124 idiom): RLS
-- that is not forced, a privilege that did not arrive through 0041's defaults,
-- a membership the receiver's aggregate refresh needs, or a constraint or index
-- under another name reads correct in this file and guards nothing.
-- has_table_privilege follows role membership (the 0059 reason); pg_has_role's
-- SET mode is PostgreSQL 16, the floor 0044 already set.
DO $$
DECLARE
  wanted text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'bms'
       AND c.relname = 'edge_gateways'
       AND c.relrowsecurity
       AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION
      'migration 0141: row level security is not enabled and forced on bms.edge_gateways';
  END IF;

  IF NOT has_table_privilege('bms_fleet', 'bms.edge_gateways', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0141: bms_fleet holds no SELECT on bms.edge_gateways';
  END IF;

  IF NOT has_table_privilege('bms_fleet', 'bms.edge_gateways', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0141: bms_fleet holds no UPDATE on bms.edge_gateways (0041 default privileges did not reach it; ADR 0123 does not hold)';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.edge_gateways', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0141: bms_tenant holds no SELECT on bms.edge_gateways';
  END IF;

  IF NOT pg_has_role('bms_fleet', 'bms_rollup', 'SET') THEN
    RAISE EXCEPTION 'migration 0141: bms_fleet cannot SET ROLE bms_rollup (0044 membership missing; ADR 0123 does not hold)';
  END IF;

  FOREACH wanted SLICE 1 IN ARRAY ARRAY[
    ARRAY['edge_gateways_organization_id_fkey', 'bms.edge_gateways'],
    ARRAY['edge_gateways_location_id_organization_id_fkey', 'bms.edge_gateways'],
    ARRAY['edge_gateways_organization_id_code_key', 'bms.edge_gateways'],
    ARRAY['edge_gateways_id_organization_id_key', 'bms.edge_gateways'],
    ARRAY['edge_gateways_status_check', 'bms.edge_gateways'],
    ARRAY['edge_gateways_clock_state_check', 'bms.edge_gateways'],
    ARRAY['edge_gateways_token_hash_check', 'bms.edge_gateways'],
    ARRAY['edge_gateways_backfill_window_check', 'bms.edge_gateways'],
    ARRAY['rtus_edge_gateway_id_organization_id_fkey', 'bms.rtus']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = wanted[1]
        AND conrelid = wanted[2]::regclass
    ) THEN
      RAISE EXCEPTION 'migration 0141: constraint % does not exist on %', wanted[1], wanted[2];
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE i.indrelid = 'bms.edge_gateways'::regclass
       AND ic.relname = 'edge_gateways_token_hash_key'
       AND i.indisunique
       AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'migration 0141: partial unique index edge_gateways_token_hash_key is missing on bms.edge_gateways';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE i.indrelid = 'bms.rtus'::regclass
       AND ic.relname = 'rtus_edge_gateway_id_idx'
  ) THEN
    RAISE EXCEPTION 'migration 0141: index rtus_edge_gateway_id_idx is missing on bms.rtus';
  END IF;
END $$;
