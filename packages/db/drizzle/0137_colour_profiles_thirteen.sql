-- F4.346 / ADR 0118 Amendment 3 decision 5 — the closed list of colour
-- profiles grows from nine names to thirteen: hmi-grey, moss, colour-safe and
-- night-shift join, after the nine, in the contract's order
-- (`packages/shared/src/contracts/colour-profile.ts`).
--
--   - The three `colour_profile` CHECKs are dropped by name and re-added with
--     the thirteen names: `organizations_colour_profile_check` (last set by
--     0133), `portal_settings_colour_profile_check` and
--     `users_colour_profile_check` (both from 0134). It lands with the profile
--     values (the same PR), so a choice of a new profile can never fail with
--     23514 between PRs. `tests/f4.346-colour-profiles-thirteen-schema.test.ts`
--     holds the three lists to the contract. 0133 and 0134 (frozen) keep the
--     nine-name lists.
--   - No column changes. `varchar(32)` already fits the longest name
--     (`high-contrast`, 13 characters; `colour-safe` and `night-shift` are 11).
--     No existing row changes: every stored value is one of the nine, and the
--     nine are in the new list. A NULL still passes each CHECK.
--
-- POLICY. None: none of the three tables carries a policy (F4.16 / ADR 0043,
-- ADR 0118 decision 9).
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the tables'
-- owner, as 0133 and 0134 did. No GRANT: a CHECK changes no privilege.
--
-- Forward-only. Idempotent: each CHECK is dropped by name before it is added.

SET ROLE bms_owner;

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_colour_profile_check;

ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast', 'forest', 'sand', 'navy-pop', 'hmi-grey', 'moss', 'colour-safe', 'night-shift'));

ALTER TABLE bms.portal_settings DROP CONSTRAINT IF EXISTS portal_settings_colour_profile_check;

ALTER TABLE bms.portal_settings
  ADD CONSTRAINT portal_settings_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast', 'forest', 'sand', 'navy-pop', 'hmi-grey', 'moss', 'colour-safe', 'night-shift'));

ALTER TABLE bms.users DROP CONSTRAINT IF EXISTS users_colour_profile_check;

ALTER TABLE bms.users
  ADD CONSTRAINT users_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast', 'forest', 'sand', 'navy-pop', 'hmi-grey', 'moss', 'colour-safe', 'night-shift'));

RESET ROLE;
