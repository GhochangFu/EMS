-- ADR 0051 Amendment 1 decision 1 — the database draws the line the ADR draws.
--
-- Amendment 1 rules that through onboarding a tenant administrator "may
-- *extend*" the fleet-wide point-key catalog and "still cannot *edit* fleet-wide
-- master data". Until this migration the database did not draw that line at all.
-- `0057` dropped `bms.point_keys`' `tenant_isolation` policy and its FORCE flag
-- to make the catalog global, and `0041:112` grants `SELECT, INSERT, UPDATE,
-- DELETE` on every `bms` table to `bms_tenant` by default privilege. With no
-- policy left, the grant IS the control, and it permitted two verbs the ADR
-- forbids.
--
-- WHY THIS TABLE AND NOT THE WHOLE GLOBAL-VOCABULARY CLASS. `asset_domains`,
-- `rule_categories`, `alarm_severities`, `alarm_skills`, `asset_roles` and
-- `dashboard_sections` carry the same grant and the same absent policy. They
-- differ in the one way that matters: no code path writes any of them on the
-- tenant pool. `bms.point_keys` has one — `OnboardingCommitService` opens
-- `withTenant(this.tenantDb, …)` and inserts a catalog row inside it, which is
-- exactly what Amendment 1 authorises. A live tenant-pool writer is what turns
-- a latent grant into a reachable surface, so this table is where the revoke is
-- owed and the others are not yet.
--
-- WHAT A TENANT COULD REACH WITHOUT IT, and why it does not self-correct. A
-- single `UPDATE bms.point_keys SET active = false` on the tenant pool retires a
-- code for the whole fleet: `AssetTemplatesService.assertPointKeysActive` then
-- refuses every OTHER organization's template edit and publish on that code, and
-- `TelemetryWriteService` resolves an unmapped point's unit from the catalog
-- row. Only a global administrator can undo it — `PointKeysAdminService` gates
-- all four mutations on `isGlobalAdmin`.
--
-- INSERT AND SELECT DELIBERATELY SURVIVE. INSERT is the authorised extension
-- path and it is not merely permitted but load-bearing: the onboarding write
-- sits inside the estate's own transaction, so moving it to the fleet
-- connection would trade this exposure for orphan catalog rows whenever a
-- commit fails after it. SELECT is what every tenant needs to read the
-- vocabulary at all. Both are asserted below, because a revoke that takes too
-- much is the other way this can go wrong.
--
-- MEASURED BEFORE IT WAS WRITTEN, on the running stack on 2026-09-01: every
-- production `UPDATE` and `DELETE` of `bms.point_keys` runs on `fleetDb`
-- (`point-keys.service.ts:129`, `:160`, `:181`), and every test cleanup runs on
-- an owner or fleet pool. Nothing loses a privilege it uses.
--
-- Forward-only and idempotent: `REVOKE` of a privilege that is not held is a
-- no-op, not an error.

-- `bms_owner` is the grantor. The privilege came from `ALTER DEFAULT PRIVILEGES
-- FOR ROLE bms_owner` (`0041:112`), and only the grantor may revoke it — a
-- superuser issuing the same statement removes nothing and reports success.
SET ROLE bms_owner;

REVOKE UPDATE, DELETE ON bms.point_keys FROM bms_tenant;

RESET ROLE;

-- The proof, outside the bracket and as the migrator's own superuser role.
--
-- `has_table_privilege` rather than `information_schema`: the information schema
-- shows only grants whose grantor or grantee is a currently enabled role, so it
-- can report an empty set for a privilege that is still held. `has_table_
-- privilege` answers the question the server answers, and it follows role
-- membership — so a privilege `bms_tenant` inherits from some other role is
-- caught here rather than surviving a revoke that looked complete.
DO $$
BEGIN
  IF has_table_privilege('bms_tenant', 'bms.point_keys', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.point_keys', 'DELETE') THEN
    RAISE EXCEPTION
      'migration 0059: bms_tenant still holds UPDATE or DELETE on bms.point_keys'
      USING HINT =
        'The REVOKE ran as bms_owner and reported success, so the privilege '
        || 'arrives by another route — most likely a role bms_tenant is a member '
        || 'of. Find it with \pset and pg_auth_members, and revoke it there.';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.point_keys', 'SELECT')
     OR NOT has_table_privilege('bms_tenant', 'bms.point_keys', 'INSERT') THEN
    RAISE EXCEPTION
      'migration 0059: bms_tenant lost SELECT or INSERT on bms.point_keys'
      USING HINT =
        'This migration must remove exactly two verbs. SELECT is how every '
        || 'tenant reads the vocabulary, and INSERT is ADR 0051 Amendment 1 '
        || 'decision 1''s authorised onboarding extension path.';
  END IF;
END $$;
