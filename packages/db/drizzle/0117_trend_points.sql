-- F4.300 / ADR 0108 decision 3 (plan calls C1, C2, C5, C9) - the key trend points of
-- each segment: a per-code catalog flag, and an optional per-organization
-- override list per segment.
--
-- 1. bms.point_keys.trend_default boolean, NULLABLE (C2). It is tri-state:
--    NULL = undecided (the seed may fill it); true / false = decided, by the seed
--    or by a global administrator. A NOT NULL DEFAULT false column could not tell
--    "an administrator said no" from "nobody said", so every compose up would
--    revert an administrator's false. The seed writes only WHERE trend_default IS
--    NULL (the headline_rank IS NULL rule of F3.68).
--
-- 2. bms.point_keys_refuse_tenant_trend_default() and a BEFORE INSERT trigger
--    (C5; the 0084 shape, a second function - 0084 is frozen). bms_tenant may not
--    insert a catalog row with ANY decided value, true or false: the catalog flag
--    is fleet-wide master data, and a tenant false would be a decided value the
--    seed never fills. An organization's choice goes in bms.org_trend_points.
--    The check is current_user = 'bms_tenant' (not session_user), the function is
--    SECURITY INVOKER (under SECURITY DEFINER current_user would be the owner and
--    the guard would never fire), and the proof below asserts both. ONLY INSERT
--    needs a trigger: 0059 left bms_tenant exactly SELECT and INSERT on
--    bms.point_keys, so an UPDATE and INSERT ... ON CONFLICT DO UPDATE are
--    refused by the privilege system before any trigger runs. SQLSTATE 42501, and
--    the message names trend_default so it is told apart from a revoked-INSERT
--    "permission denied".
--
-- 3. bms.org_trend_points (C1, C3, C9). One row per (organization, segment, point
--    key); a segment is a bms.asset_domains.code. No row for an (organization,
--    segment) pair means the catalog default applies. FKs to asset_domains, point_keys
--    and users carry no ON DELETE clause: both vocabularies are retire-only
--    (active = false), so a delete that plant still references fails loudly.
--    No index beyond the primary key: reads filter on the leading column.
--
--    The policy carries the own-column check only, in USING and in WITH CHECK, with
--    no NULL disjunct. asset_domains and point_keys are GLOBAL tables, so no
--    foreign-row leg exists to add (0082 carries none for users either).
--
-- WHY THIS FILE WRITES NO GRANT. 0041_bms_owner_and_force_rls.sql sets ALTER
-- DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE,
-- DELETE ON TABLES TO bms_tenant, bms_fleet (and the sequence half). Default
-- privileges fire only for objects created by the role they name, so the table is
-- created as bms_owner inside SET ROLE / RESET ROLE: created as bms_app it would
-- reach no pool role and the tenant PUT and the fleet read would fail at runtime.
-- 0045 is not the source (its default privileges are FOR ROLE bms_rollup only).
-- The trend_default column needs no grant (table-level privileges cover a new
-- column), and the 0059 tenant revoke on bms.point_keys is unchanged. The same
-- sentence is in 0082_site_control_room_views.sql and 0078_report_schedules.sql.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent.

SET ROLE bms_owner;

ALTER TABLE bms.point_keys ADD COLUMN IF NOT EXISTS trend_default boolean;

COMMENT ON COLUMN bms.point_keys.trend_default IS 'NULL = undecided, seed may fill; true/false = decided (ADR 0108).';

CREATE OR REPLACE FUNCTION bms.point_keys_refuse_tenant_trend_default()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF current_user = 'bms_tenant' AND NEW.trend_default IS NOT NULL THEN
    RAISE EXCEPTION 'bms_tenant may not set bms.point_keys.trend_default'
      USING ERRCODE = '42501',
            DETAIL = 'The catalog trend flag is fleet-wide master data (ADR 0108 decision 3).',
            HINT = 'Insert the catalog row without the flag; an organization sets its own list in bms.org_trend_points.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS point_keys_refuse_tenant_trend_default ON bms.point_keys;

CREATE TRIGGER point_keys_refuse_tenant_trend_default
  BEFORE INSERT ON bms.point_keys
  FOR EACH ROW
  EXECUTE FUNCTION bms.point_keys_refuse_tenant_trend_default();

CREATE TABLE IF NOT EXISTS bms.org_trend_points (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  domain varchar(64) NOT NULL REFERENCES bms.asset_domains(code),
  point_key varchar(128) NOT NULL REFERENCES bms.point_keys(code),
  sort_order smallint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES bms.users(id),
  PRIMARY KEY (organization_id, domain, point_key),
  CONSTRAINT org_trend_points_sort_order_check CHECK (sort_order >= 0)
);

ALTER TABLE bms.org_trend_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.org_trend_points FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.org_trend_points;
CREATE POLICY tenant_isolation ON bms.org_trend_points
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

COMMENT ON TABLE bms.org_trend_points IS 'No row for (organization, domain) = the catalog default (ADR 0108 decision 3).';

RESET ROLE;

-- The proof, as the migrator's own superuser role (the 0084 shape): a trigger
-- that exists but is disabled, or a function that became SECURITY DEFINER, reads
-- correct in this file and guards nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms'
       AND c.relname = 'point_keys'
       AND t.tgname = 'point_keys_refuse_tenant_trend_default'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION
      'migration 0117: trigger point_keys_refuse_tenant_trend_default is missing or not enabled on bms.point_keys';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bms'
       AND p.proname = 'point_keys_refuse_tenant_trend_default'
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION
      'migration 0117: bms.point_keys_refuse_tenant_trend_default is SECURITY DEFINER'
      USING HINT = 'Under SECURITY DEFINER current_user is the owner, so the bms_tenant check never fires.';
  END IF;
END $$;
