-- F3.85 PR 6 / ADR 0099 decision 11 and Amendment 1 A1, A2 — the administrator
-- copilot's daily turn counters, and the organization timezone that names the
-- day.
--
--   - `bms.copilot_usage`: one row per (user, day). `turns` is the number of
--     copilot turns that user has spent that day. The per-user limit
--     (`COPILOT_USER_DAILY_TURNS`) is enforced by the API in the same
--     transaction as the increment; the table only refuses a negative count.
--   - `bms.copilot_org_usage`: one row per (organization, day), the
--     organization-wide limit (`COPILOT_ORG_DAILY_TURNS`). A cross-organization
--     turn of a global admin touches the user counter only (A1).
--   - `bms.organizations.timezone`: the IANA zone whose calendar date is the
--     `day` key (A2). `NOT NULL DEFAULT 'UTC'`, so existing rows and a create
--     that names no zone keep the UTC day. The API validates the name on write;
--     the column is `varchar(64)`, the length of `bms.locations.timezone`.
--
-- POLICY. `copilot_usage` is the user's alone: a strict `user_isolation`
-- policy on the `app.current_user` setting `withUser` sets (the 0105
-- precedent). `copilot_org_usage` is the organization's: a strict
-- `tenant_isolation` policy on `app.current_organization` (the 0050 rule: no
-- `IS NULL` disjunct), `USING` and `WITH CHECK`. Both are `ENABLE` and `FORCE`.
-- `withUser(..., { organizationId })` sets both settings in one transaction.
--
-- ROLE AND GRANTS. Created as bms_owner inside SET ROLE / RESET ROLE. No GRANT:
-- 0041's default privileges reach bms_tenant. bms_fleet reads across
-- organizations and has no use for a usage counter, so it loses every
-- privilege on both tables (the 0105 precedent). `ADD COLUMN` on
-- `bms.organizations` runs as its owner, bms_owner.
--
-- Forward-only. No seed rows; the seed restates the demo organizations'
-- timezone.

SET ROLE bms_owner;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS timezone varchar(64) NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS bms.copilot_usage (
  user_id uuid NOT NULL REFERENCES bms.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  turns integer NOT NULL DEFAULT 0 CHECK (turns >= 0),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS bms.copilot_org_usage (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id) ON DELETE CASCADE,
  day date NOT NULL,
  turns integer NOT NULL DEFAULT 0 CHECK (turns >= 0),
  PRIMARY KEY (organization_id, day)
);

ALTER TABLE bms.copilot_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_isolation ON bms.copilot_usage;
CREATE POLICY user_isolation ON bms.copilot_usage
  USING (user_id = nullif(current_setting('app.current_user', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.current_user', true), '')::uuid);

ALTER TABLE bms.copilot_org_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.copilot_org_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms.copilot_org_usage;
CREATE POLICY tenant_isolation ON bms.copilot_org_usage
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

REVOKE ALL ON bms.copilot_usage, bms.copilot_org_usage FROM bms_fleet;

COMMENT ON COLUMN bms.organizations.timezone IS
  'IANA zone whose calendar date keys the copilot daily counters (ADR 0099 Amendment 1 A2); UTC by default';
COMMENT ON TABLE bms.copilot_usage IS
  'Copilot turns one user has spent on one day, the day taken in the user''s home organization''s timezone (ADR 0099 decision 11, A2)';
COMMENT ON TABLE bms.copilot_org_usage IS
  'Copilot turns one organization has spent on one day, the day taken in that organization''s timezone (ADR 0099 decision 11, A2)';

RESET ROLE;
