-- F4.341 / ADR 0118 decisions 8–10, Amendment 2 (D5) — where the appearance
-- (a design system and a colour profile) is stored at each of its three
-- levels: the portal, an organization and a user. The effective value
-- resolves user > home organization > portal; a NULL falls through.
--
--   - `bms.portal_settings`: one row (`id = 1`, CHECK), the portal default.
--     Both columns NOT NULL with today's look as the default, each with a
--     CHECK on its closed list (`designSystemSchema`, `colourProfileSchema`).
--     The seed row is inserted here, so the row always exists.
--   - `bms.organizations.design_system`: nullable, CHECK; NULL = the portal
--     value. `bms.organizations.colour_profile` loses NOT NULL and its DEFAULT
--     (0125): existing rows keep their stored value, so no organization sees a
--     change; a new organization inherits the portal default.
--   - `bms.users.design_system`, `bms.users.colour_profile`: nullable, CHECK;
--     NULL = the organization's value (else the portal's).
--   `tests/f4.341-portal-appearance-schema.test.ts` holds every CHECK list to
--   its Zod enum.
--
-- POLICY. `bms.portal_settings` is a global table with no organization, the
-- `location_types` shape (0085): no RLS. `bms.organizations` and `bms.users`
-- keep their policies; a column changes no policy.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE.
--   - `bms.portal_settings` receives the default privileges of 0041 (SELECT,
--     INSERT, UPDATE, DELETE to bms_tenant and bms_fleet). It is written only
--     by the global admin's route, which runs on bms_fleet, and only by an
--     UPDATE of the one row, so INSERT, UPDATE and DELETE come off bms_tenant
--     and INSERT and DELETE off bms_fleet. bms_auth gets nothing.
--   - `bms.organizations` holds table-level grants, so its new column is
--     covered as its other columns are.
--   - `bms.users` holds COLUMN-level grants only (0039, 0046, 0098), so a new
--     column is readable by no pool role until it is granted. The two readers:
--     `/auth/me` reads the caller's two columns on bms_auth, and
--     `PUT /me/appearance` reads the old values and writes the new ones on
--     bms_fleet. bms_tenant reads neither today; it gets SELECT anyway, as 0046
--     and 0098 gave every pool role SELECT on their columns, so a tenant-pool
--     read of the row never fails on a column it cannot see. UPDATE of the two
--     columns goes to bms_fleet only.
--
-- Forward-only. Idempotent: the table and the columns are IF NOT EXISTS, the
-- seed row is ON CONFLICT DO NOTHING, every CHECK is dropped by name before it
-- is added, and the GRANT/REVOKE statements are repeatable.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.portal_settings (
  id smallint PRIMARY KEY,
  design_system varchar(32) NOT NULL DEFAULT 'nexus-soft',
  colour_profile varchar(32) NOT NULL DEFAULT 'nexus',
  updated_at timestamptz,
  updated_by uuid REFERENCES bms.users(id) ON DELETE SET NULL
);

ALTER TABLE bms.portal_settings DROP CONSTRAINT IF EXISTS portal_settings_single_row_check;
ALTER TABLE bms.portal_settings
  ADD CONSTRAINT portal_settings_single_row_check CHECK (id = 1);

ALTER TABLE bms.portal_settings DROP CONSTRAINT IF EXISTS portal_settings_design_system_check;
ALTER TABLE bms.portal_settings
  ADD CONSTRAINT portal_settings_design_system_check
  CHECK (design_system IN ('nexus-soft', 'enterprise-flat', 'swiss-grid', 'bento-ops', 'control-room-dark'));

ALTER TABLE bms.portal_settings DROP CONSTRAINT IF EXISTS portal_settings_colour_profile_check;
ALTER TABLE bms.portal_settings
  ADD CONSTRAINT portal_settings_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast', 'forest', 'sand', 'navy-pop'));

INSERT INTO bms.portal_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

REVOKE INSERT, UPDATE, DELETE ON bms.portal_settings FROM bms_tenant;
REVOKE INSERT, DELETE ON bms.portal_settings FROM bms_fleet;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS design_system varchar(32);

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_design_system_check;
ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_design_system_check
  CHECK (design_system IN ('nexus-soft', 'enterprise-flat', 'swiss-grid', 'bento-ops', 'control-room-dark'));

ALTER TABLE bms.organizations ALTER COLUMN colour_profile DROP NOT NULL;
ALTER TABLE bms.organizations ALTER COLUMN colour_profile DROP DEFAULT;

ALTER TABLE bms.users ADD COLUMN IF NOT EXISTS design_system varchar(32);
ALTER TABLE bms.users ADD COLUMN IF NOT EXISTS colour_profile varchar(32);

ALTER TABLE bms.users DROP CONSTRAINT IF EXISTS users_design_system_check;
ALTER TABLE bms.users
  ADD CONSTRAINT users_design_system_check
  CHECK (design_system IN ('nexus-soft', 'enterprise-flat', 'swiss-grid', 'bento-ops', 'control-room-dark'));

ALTER TABLE bms.users DROP CONSTRAINT IF EXISTS users_colour_profile_check;
ALTER TABLE bms.users
  ADD CONSTRAINT users_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast', 'forest', 'sand', 'navy-pop'));

GRANT SELECT (design_system, colour_profile) ON bms.users TO bms_tenant, bms_fleet, bms_auth;
GRANT UPDATE (design_system, colour_profile) ON bms.users TO bms_fleet;

RESET ROLE;
