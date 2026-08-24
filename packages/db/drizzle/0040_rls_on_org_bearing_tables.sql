-- F4.16 / ADR 0043 decisions 4, 5 and 10.
-- Only the five tables that already carry organization_id. E7.1 adds the column
-- and a matching policy to the rest; this file is the mechanism, proved end to
-- end on the tables that can carry it today.
--
-- ENABLE, and deliberately NOT FORCE. Ruled at the §10 gate on 2026-08-24 and
-- recorded in ADR 0043 Amendment 1: FORCE binds the table owner, and bms_app is
-- the owner that runs pnpm db:seed, which inserts into four of these five in
-- bulk arrays spanning organizations. RLS constrains bms_tenant and bms_auth
-- regardless of FORCE, because neither is the owner, so nothing this item claims
-- depends on it. FORCE lands in E7.1 with the full table set and the seed
-- restructuring it requires. Do not "fix" this by adding FORCE here.

ALTER TABLE bms.locations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.user_organization_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.point_keys                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.onboarding_sessions       ENABLE ROW LEVEL SECURITY;

-- current_setting(..., true) returns NULL rather than raising when the GUC is
-- unset, so a connection with no tenant sees nothing instead of erroring. Fail
-- closed, and fail quietly enough that a missing SET LOCAL shows up as an empty
-- result in a test rather than a 500 in production.
DROP POLICY IF EXISTS tenant_isolation ON bms.locations;
CREATE POLICY tenant_isolation ON bms.locations
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.user_organization_access;
CREATE POLICY tenant_isolation ON bms.user_organization_access
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.point_keys;
CREATE POLICY tenant_isolation ON bms.point_keys
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.asset_templates;
CREATE POLICY tenant_isolation ON bms.asset_templates
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.onboarding_sessions;
CREATE POLICY tenant_isolation ON bms.onboarding_sessions
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

-- Amendment 1: the identity bootstrap runs before any tenant is set, so it
-- cannot satisfy the policy above. bms_auth gets a read-only permissive policy
-- on the two tables it walks. It is not BYPASSRLS — the exemption is scoped to
-- these two tables, by name, and to SELECT, and it disappears in E7.1 when
-- bms.users carries organization_id and the walk is no longer needed.
DROP POLICY IF EXISTS auth_bootstrap_read ON bms.locations;
CREATE POLICY auth_bootstrap_read ON bms.locations
  FOR SELECT TO bms_auth USING (true);

DROP POLICY IF EXISTS auth_bootstrap_read ON bms.user_organization_access;
CREATE POLICY auth_bootstrap_read ON bms.user_organization_access
  FOR SELECT TO bms_auth USING (true);
