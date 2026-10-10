-- F3.85 PR 3 / ADR 0099 decision 5 — who may use the administrator copilot.
--
-- Three tables, read in this order by `CopilotAvailabilityService`:
--   - `bms.copilot_org_settings`: one organization's switch. No row means OFF
--     (ruling 15: a new organization starts off). Only the global admin writes
--     it.
--   - `bms.copilot_role_settings`: the switch for one scoped admin role in one
--     organization. No row means ON (plan Q2); the organization switch always
--     wins. `organization_admin` has no role switch — its organization switch
--     is its switch.
--   - `bms.copilot_user_overrides`: a named-user exception, in either
--     direction (Q2): `allow = true` re-enables a user whose role switch is
--     off, `allow = false` denies a user whose role switch is on.
--
-- CONSTRAINTS. Each table is keyed by its organization and cascades with it;
-- an override also cascades with its user. `copilot_role_settings_role_check`
-- is a CHECK and not a vocabulary table: the two roles are the only ones the
-- service reads a role switch for. The drizzle mirror in `copilot-schema.ts`
-- does not repeat it; `tests/f3.85-copilot-access-schema.test.ts` pins it.
--
-- POLICY. `ENABLE` and `FORCE ROW LEVEL SECURITY`; the strict
-- `tenant_isolation` form with `USING` and `WITH CHECK`, no `IS NULL`
-- disjunct (the 0050 rule). `updated_by` and `user_id` reference
-- `bms.users`; foreign-key checks run with row security off, so they need no
-- leg.
--
-- ROLE AND GRANTS. Created as bms_owner inside SET ROLE / RESET ROLE. No GRANT
-- and no REVOKE (the 0100 model): 0041's default privileges grant the pool
-- roles. bms_fleet keeps its default DML here, as on 0100: the tables hold no
-- secret, and the global admin's Organizations page reads every
-- organization's switch in one fleet read.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.copilot_org_settings (
  organization_id uuid PRIMARY KEY REFERENCES bms.organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES bms.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms.copilot_role_settings (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id) ON DELETE CASCADE,
  role varchar(64) NOT NULL,
  enabled boolean NOT NULL,
  updated_by uuid REFERENCES bms.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, role),
  CONSTRAINT copilot_role_settings_role_check CHECK (role IN ('location_admin','asset_group_admin'))
);

CREATE TABLE IF NOT EXISTS bms.copilot_user_overrides (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES bms.users(id) ON DELETE CASCADE,
  allow boolean NOT NULL,
  updated_by uuid REFERENCES bms.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE bms.copilot_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_org_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.copilot_org_settings;
CREATE POLICY tenant_isolation ON bms.copilot_org_settings
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

ALTER TABLE bms.copilot_role_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_role_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.copilot_role_settings;
CREATE POLICY tenant_isolation ON bms.copilot_role_settings
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

ALTER TABLE bms.copilot_user_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_user_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.copilot_user_overrides;
CREATE POLICY tenant_isolation ON bms.copilot_user_overrides
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

COMMENT ON TABLE bms.copilot_org_settings IS
  'One organization''s administrator-copilot switch; no row means off (ADR 0099 decision 5, ruling 15)';
COMMENT ON TABLE bms.copilot_role_settings IS
  'The copilot switch for location_admin or asset_group_admin in one organization; no row means on (ADR 0099 decision 5, F3.85 plan Q2)';
COMMENT ON TABLE bms.copilot_user_overrides IS
  'A named-user copilot exception in one organization, allow or deny (ADR 0099 decision 5, F3.85 plan Q2)';

RESET ROLE;
