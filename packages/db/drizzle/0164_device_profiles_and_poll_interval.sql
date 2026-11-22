-- F1.2 / ADR 0141 decisions 10, 12, 13 and Amendment 1 - device profiles and the
-- organization's default poll interval (plan
-- docs/plans/f1.2-modbus-tcp-adapter-and-device-profiles.md section 5, PR 2).
--
--   bms.organizations.default_poll_interval_ms   the organization's poll interval
--                               for every poll protocol, between the endpoint's own
--                               config.pollIntervalMs and the adapter's default.
--                               NULL means "no organization default"; no backfill.
--                               The bounds are POLL_INTERVAL_MIN_MS and
--                               POLL_INTERVAL_MAX_MS (packages/shared/src/
--                               ingest-poll-interval.ts), pinned equal by
--                               tests/f1.2-device-profiles-schema.test.ts.
--   bms.device_profiles         an organization's Modbus device profiles. Every
--                               save is a new row at max(version) + 1, and a row
--                               is never edited (plan P2), so a bound device's
--                               { code, version } always names what was copied.
--                               registers holds 1 to 256 entries
--                               (MODBUS_REGISTERS_MAX); the API validates each
--                               entry with modbusRegistersSchema before a write.
--                               stock_code / stock_version record the stock file
--                               a row was imported from: both or neither.
--
-- ROW LEVEL SECURITY. organization_id NOT NULL, ENABLE and FORCE, and the strict
-- tenant_isolation policy (USING and WITH CHECK, the GUC alone, no NULL
-- disjunct, no OR): with the setting unset a role matches nothing (ADR 0043,
-- 0045). bms.organizations carries no policy, and a new column changes no grant
-- (the 0128 reasoning).
--
-- THE GRANTS. None written (AGENTS.md section 4.4, plan M17): 0041's default
-- privileges give bms_tenant and bms_fleet SELECT, INSERT, UPDATE and DELETE on
-- every table bms_owner creates in bms. This table wants less, so it revokes
-- (the 0144 / 0162 shape): APPEND-ONLY BY PRIVILEGE, because plan P2 says a row
-- is never edited or removed, and a bound device's { code, version } must keep
-- naming what was copied. bms_tenant keeps SELECT and INSERT; bms_fleet, which
-- bypasses RLS, keeps SELECT only. bms_auth gets nothing. A save from the same
-- base version is settled by the unique key (23505), not by SELECT ... FOR
-- UPDATE, which needs UPDATE. The ingest host never reads this table: binding
-- copies the registers into rtu_connection_configs.config.device (decision 15).
-- The table holds no secret.
--
-- UNIQUE (id, organization_id) lets a later table carry a composite foreign key
-- that pins a reference to the same organization.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the one
-- SET ROLE bms_owner / RESET ROLE bracket: bms_owner owns the new table, so
-- 0041's default privileges apply to it, and the REVOKEs are made by the role
-- whose default privileges granted them. Forward-only and idempotent: the column
-- and the table are IF NOT EXISTS, the organizations CHECK is dropped before it
-- is added (the 0153 idiom), the policy is dropped before it is created, a
-- REVOKE that already holds is a no-op. The
-- table is new and empty, so its CHECKs are inline. No statement-breakpoint
-- markers (the 0038 reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS default_poll_interval_ms integer;

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_default_poll_interval_ms_check;

ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_default_poll_interval_ms_check
  CHECK (default_poll_interval_ms BETWEEN 1000 AND 3600000);

CREATE TABLE IF NOT EXISTS bms.device_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  protocol varchar(32) NOT NULL,
  code varchar(64) NOT NULL,
  version integer NOT NULL,
  vendor varchar(128) NOT NULL,
  model varchar(128) NOT NULL,
  source jsonb NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  registers jsonb NOT NULL,
  stock_code varchar(64),
  stock_version integer,
  created_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_profiles_org_protocol_code_version_key UNIQUE (organization_id, protocol, code, version),
  CONSTRAINT device_profiles_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT device_profiles_protocol_check CHECK (protocol = 'modbus_tcp'),
  CONSTRAINT device_profiles_code_check CHECK (code ~ '^[A-Za-z0-9_-]+$'),
  CONSTRAINT device_profiles_version_check CHECK (version >= 1),
  CONSTRAINT device_profiles_source_check CHECK (jsonb_typeof(source) = 'object'),
  CONSTRAINT device_profiles_registers_check CHECK (
    jsonb_typeof(registers) = 'array' AND jsonb_array_length(registers) BETWEEN 1 AND 256
  ),
  CONSTRAINT device_profiles_stock_check CHECK (
    (stock_code IS NULL) = (stock_version IS NULL)
    AND (stock_version IS NULL OR stock_version >= 1)
  )
);

ALTER TABLE bms.device_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE bms.device_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.device_profiles;

CREATE POLICY tenant_isolation ON bms.device_profiles
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

REVOKE UPDATE, DELETE ON bms.device_profiles FROM bms_tenant;

REVOKE INSERT, UPDATE, DELETE ON bms.device_profiles FROM bms_fleet;

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator's own superuser role, in the 0162 shape.
-- has_table_privilege follows role membership (the 0059 reason), and
-- has_any_column_privilege also sees a column-level grant a table-level check
-- would miss. If 0041's default privileges did not reach the new table,
-- bms_tenant would hold no INSERT or SELECT and the migration fails here rather
-- than in the API; a dropped REVOKE above fails it too.
DO $$
DECLARE
  verb text;
  con text;
  policies integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'bms' AND c.relname = 'device_profiles'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'migration 0164: bms.device_profiles is missing or its row level security is not enabled and forced';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'bms' AND tablename = 'device_profiles' AND policyname = 'tenant_isolation'
       AND qual LIKE '%app.current_organization%' AND with_check LIKE '%app.current_organization%'
       AND qual NOT LIKE '%IS NULL%' AND with_check NOT LIKE '%IS NULL%'
       AND qual !~* '\mor\M' AND with_check !~* '\mor\M'
  ) THEN
    RAISE EXCEPTION 'migration 0164: policy tenant_isolation on bms.device_profiles does not scope USING and WITH CHECK to app.current_organization alone';
  END IF;

  SELECT count(*) INTO policies FROM pg_policies WHERE schemaname = 'bms' AND tablename = 'device_profiles';
  IF policies <> 1 THEN
    RAISE EXCEPTION 'migration 0164: bms.device_profiles carries % policies; tenant_isolation must be the only one', policies;
  END IF;

  FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege('bms_tenant', 'bms.device_profiles', verb) THEN
      RAISE EXCEPTION 'migration 0164: bms_tenant holds no % on bms.device_profiles (0041 default privileges)', verb;
    END IF;
  END LOOP;
  FOREACH verb IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('bms_tenant', 'bms.device_profiles', verb) THEN
      RAISE EXCEPTION 'migration 0164: bms_tenant holds % on bms.device_profiles', verb;
    END IF;
  END LOOP;
  IF has_any_column_privilege('bms_tenant', 'bms.device_profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0164: bms_tenant holds a column-level UPDATE on bms.device_profiles';
  END IF;

  IF NOT has_table_privilege('bms_fleet', 'bms.device_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0164: bms_fleet holds no SELECT on bms.device_profiles';
  END IF;
  FOREACH verb IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('bms_fleet', 'bms.device_profiles', verb) THEN
      RAISE EXCEPTION 'migration 0164: bms_fleet holds % on bms.device_profiles', verb;
    END IF;
  END LOOP;
  FOREACH verb IN ARRAY ARRAY['INSERT', 'UPDATE'] LOOP
    IF has_any_column_privilege('bms_fleet', 'bms.device_profiles', verb) THEN
      RAISE EXCEPTION 'migration 0164: bms_fleet holds a column-level % on bms.device_profiles', verb;
    END IF;
  END LOOP;

  FOREACH verb IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('bms_auth', 'bms.device_profiles', verb) THEN
      RAISE EXCEPTION 'migration 0164: bms_auth holds % on bms.device_profiles', verb;
    END IF;
  END LOOP;

  FOREACH con IN ARRAY ARRAY['protocol', 'code', 'version', 'vendor', 'model', 'source', 'verified', 'registers', 'organization_id', 'created_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'bms.device_profiles'::regclass AND attname = con AND attnotnull AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'migration 0164: bms.device_profiles.% is missing or nullable', con;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'bms.organizations'::regclass AND attname = 'default_poll_interval_ms'
       AND NOT attisdropped AND NOT attnotnull AND atttypid = 'integer'::regtype
  ) THEN
    RAISE EXCEPTION 'migration 0164: bms.organizations.default_poll_interval_ms is missing, not nullable or not an integer';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organizations_default_poll_interval_ms_check' AND conrelid = 'bms.organizations'::regclass
  ) THEN
    RAISE EXCEPTION 'migration 0164: constraint organizations_default_poll_interval_ms_check is missing on bms.organizations';
  END IF;

  FOREACH con IN ARRAY ARRAY[
    'device_profiles_org_protocol_code_version_key',
    'device_profiles_id_org_key',
    'device_profiles_protocol_check',
    'device_profiles_code_check',
    'device_profiles_version_check',
    'device_profiles_source_check',
    'device_profiles_registers_check',
    'device_profiles_stock_check'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = con AND conrelid = 'bms.device_profiles'::regclass
    ) THEN
      RAISE EXCEPTION 'migration 0164: constraint % is missing on bms.device_profiles', con;
    END IF;
  END LOOP;
END $$;
