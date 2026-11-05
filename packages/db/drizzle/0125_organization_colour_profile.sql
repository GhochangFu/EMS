-- F4.310 / ADR 0110 decision 6 — the colour profile an organization chose.
--
--   - `bms.organizations.colour_profile`: one of the six names of
--     `colourProfileSchema` (`packages/shared/src/contracts/colour-profile.ts`).
--     `NOT NULL DEFAULT 'nexus'`, so every existing organization keeps today's
--     colours until an administrator chooses. `varchar(32)`: the longest name,
--     `high-contrast`, is 13 characters.
--   - `organizations_colour_profile_check`: the closed list. A new name is a
--     contract change, an amendment to ADR 0110 and a new migration.
--     `tests/f4.310-organization-colour-profile-schema.test.ts` holds this list
--     to `colourProfileSchema`.
--
-- POLICY. None: `bms.organizations` carries no policy (F4.16 / ADR 0043), and a
-- column changes no grant. The API gates the write (ADR 0110 decision 7).
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0106 did for `timezone`. No GRANT.
--
-- Forward-only. Idempotent: the column is `IF NOT EXISTS`, and the CHECK is
-- dropped by name before it is added.

SET ROLE bms_owner;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS colour_profile varchar(32) NOT NULL DEFAULT 'nexus';

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_colour_profile_check;

ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast'));

RESET ROLE;
