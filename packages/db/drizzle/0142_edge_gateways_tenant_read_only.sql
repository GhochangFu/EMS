-- E7.2 / ADR 0123 decision 12 - the tenant pool reads bms.edge_gateways and
-- cannot write it. Found by the PR 2 security review (L1), after 0141 was
-- committed, so it ships forward-only here rather than as an edit to 0141.
--
-- WHY. 0041:112 grants SELECT, INSERT, UPDATE and DELETE on every new bms table
-- to bms_tenant by default privilege, and 0141 created bms.edge_gateways under
-- it. Gateways are global-admin only and are written on the fleet pool (ADR
-- 0123 decision 12): the admin routes run as bms_fleet, and the cloud receiver
-- updates last_seen_at, reported_backlog, clock_state and the dirty window as
-- bms_fleet. No code path writes the table on the tenant pool, so the three
-- write verbs there are surface with no use: one stray tenant-pool UPDATE could
-- re-activate a revoked gateway or plant a token hash for its organization.
-- tenant_isolation bounds a tenant write to its own organization; it does not
-- make the write legitimate.
--
-- SELECT DELIBERATELY SURVIVES. tenant_isolation still bounds it to the own
-- organization, and the row holds only a hash, never a token (plan P7). The
-- proof below asserts it, because a revoke that takes too much is the other way
-- this can go wrong (the 0059 reason).
--
-- WHY INSIDE THE BRACKET. bms_owner is the grantor of 0041's default, and only
-- the grantor may revoke it: a superuser issuing the same statement removes
-- nothing and reports success (0059). No GRANT is written.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent: a REVOKE of a privilege that is not held is a
-- no-op, not an error. No statement-breakpoint markers (the 0038 reason).

SET ROLE bms_owner;

REVOKE INSERT, UPDATE, DELETE ON bms.edge_gateways FROM bms_tenant;

RESET ROLE;

-- The proof, outside the bracket and as the migrator's own superuser role.
-- has_table_privilege rather than information_schema, and it follows role
-- membership, so a write verb bms_tenant inherits from another role is caught
-- here rather than surviving a revoke that looked complete (0059). The policy
-- and the two composite keys are re-asserted in their full shape (the 0113
-- idiom), so this file proves the table's whole tenant boundary in one place.
DO $$
DECLARE
  wanted text[];
BEGIN
  IF has_table_privilege('bms_tenant', 'bms.edge_gateways', 'INSERT')
     OR has_table_privilege('bms_tenant', 'bms.edge_gateways', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.edge_gateways', 'DELETE') THEN
    RAISE EXCEPTION
      'migration 0142: bms_tenant still holds INSERT, UPDATE or DELETE on bms.edge_gateways'
      USING HINT =
        'The REVOKE ran as bms_owner and reported success, so the privilege '
        || 'arrives by another route, most likely a role bms_tenant is a member of.';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.edge_gateways', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0142: bms_tenant lost SELECT on bms.edge_gateways';
  END IF;

  IF NOT has_table_privilege('bms_fleet', 'bms.edge_gateways', 'SELECT')
     OR NOT has_table_privilege('bms_fleet', 'bms.edge_gateways', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0142: bms_fleet lost SELECT or UPDATE on bms.edge_gateways';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'bms'
       AND tablename = 'edge_gateways'
       AND policyname = 'tenant_isolation'
       AND qual IS NOT NULL
       AND with_check IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'migration 0142: policy tenant_isolation with USING and WITH CHECK is missing on bms.edge_gateways';
  END IF;

  FOREACH wanted SLICE 1 IN ARRAY ARRAY[
    ARRAY['edge_gateways_location_id_organization_id_fkey', 'bms.edge_gateways'],
    ARRAY['rtus_edge_gateway_id_organization_id_fkey', 'bms.rtus']
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = wanted[1]
        AND conrelid = wanted[2]::regclass
        AND contype = 'f'
        AND confdeltype = 'a' AND confupdtype = 'a'
    ) THEN
      RAISE EXCEPTION 'migration 0142: % is not a foreign key on %, NO ACTION both ways', wanted[1], wanted[2];
    END IF;
  END LOOP;
END $$;
