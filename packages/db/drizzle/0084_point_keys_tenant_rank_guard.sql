-- F3.68 / ADR 0076 decision 7 - security review L1, owner ruling 2026-09-26:
-- bms_tenant may not set bms.point_keys.headline_rank.
--
-- WHAT IT CLOSES. 0083 added headline_rank to the fleet-wide point-key catalog.
-- 0059 left bms_tenant exactly SELECT and INSERT on the table (INSERT is ADR 0051
-- Amendment 1 decision 1's onboarding extension path). So a tenant-pool INSERT
-- could create a catalog row that already carries a rank, and that rank orders
-- the generated site card of every organization that maps the code. The rank is
-- fleet-wide presentation master data; only the seed and a global administrator
-- (PointKeysAdminService, on the fleet pool) may set it.
--
-- WHY A TRIGGER AND NOT A COLUMN GRANT. The obvious fix - revoke the table-level
-- INSERT and grant INSERT on every column except headline_rank - breaks
-- onboarding. Drizzle's insert() names EVERY column of the table and sends DEFAULT
-- for the ones the caller did not set, so OnboardingCommitService's point-key
-- insert names headline_rank (as DEFAULT) although it never sets it. PostgreSQL
-- checks the column privilege for every column the statement names, DEFAULT or
-- not, so the whole INSERT is refused. Probed on bms_f368 before this was
-- written. A BEFORE INSERT trigger sees the row VALUE instead of the column
-- list: a DEFAULT arrives as NULL and passes, and a real rank is refused. The
-- grants and the onboarding code stay exactly as they are.
--
-- HOW IT NAMES THE TENANT: current_user = 'bms_tenant'.
--   - current_user and not session_user. The production tenant pool logs in as
--     bms_tenant, where the two are equal; the role-grants integration suite
--     reaches the role by SET LOCAL ROLE from the provisioning superuser, where
--     only current_user is bms_tenant. current_user covers both.
--   - SECURITY INVOKER, and asserted below. Inside a SECURITY DEFINER function
--     current_user is the function owner (bms_owner), so the guard would never
--     fire and nothing would say so.
--   - Equality and not pg_has_role(..., 'MEMBER'). A superuser counts as a member
--     of every role, so a membership test refuses the seed (bms_app) too.
--   bms_owner, bms_fleet and the superuser are unaffected, so the seed and the
--   admin API path keep writing ranks.
--
-- ONLY INSERT. bms_tenant holds no UPDATE on the table (0059), so an UPDATE of
-- the rank, and INSERT ... ON CONFLICT DO UPDATE, are already refused by the
-- privilege system.
--
-- SQLSTATE 42501 (insufficient_privilege): the refusal is a privilege refusal,
-- so a caller that maps 42501 maps this one too. The message names
-- headline_rank, so it is told apart from a revoked-INSERT "permission denied",
-- which carries the same code.
--
-- Forward-only and idempotent: CREATE OR REPLACE FUNCTION, then DROP TRIGGER IF
-- EXISTS and CREATE TRIGGER (PostgreSQL 16 has CREATE OR REPLACE TRIGGER, but the
-- drop-and-create pair states the same thing on any version).
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), so the function
-- and trigger are created as bms_owner, the table owner, inside SET ROLE / RESET
-- ROLE (the 0082_site_control_room_views.sql shape). The proof runs after RESET
-- ROLE, as 0059's does.

SET ROLE bms_owner;

CREATE OR REPLACE FUNCTION bms.point_keys_refuse_tenant_headline_rank()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_user = 'bms_tenant' AND NEW.headline_rank IS NOT NULL THEN
    RAISE EXCEPTION 'bms_tenant may not set bms.point_keys.headline_rank'
      USING ERRCODE = '42501',
            DETAIL = 'The headline rank is fleet-wide master data (ADR 0076 decision 7).',
            HINT = 'Insert the catalog row without a rank; a global administrator ranks it.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_keys_refuse_tenant_headline_rank ON bms.point_keys;

CREATE TRIGGER point_keys_refuse_tenant_headline_rank
  BEFORE INSERT ON bms.point_keys
  FOR EACH ROW
  EXECUTE FUNCTION bms.point_keys_refuse_tenant_headline_rank();

RESET ROLE;

-- The proof, as the migrator's own superuser role. A trigger that exists but is
-- disabled, or a function that became SECURITY DEFINER, reads correct in this
-- file and guards nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms'
       AND c.relname = 'point_keys'
       AND t.tgname = 'point_keys_refuse_tenant_headline_rank'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION
      'migration 0084: trigger point_keys_refuse_tenant_headline_rank is missing or not enabled on bms.point_keys';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bms'
       AND p.proname = 'point_keys_refuse_tenant_headline_rank'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION
      'migration 0084: bms.point_keys_refuse_tenant_headline_rank is SECURITY DEFINER'
      USING HINT = 'Under SECURITY DEFINER current_user is the owner, so the bms_tenant check never fires.';
  END IF;
END $$;
