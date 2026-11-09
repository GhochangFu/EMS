-- F4.341 / ADR 0118 decision 13, Amendment 2 (D5) — the closed list of colour
-- profiles grows from six names to nine: forest, sand and navy-pop join.
--
--   - `organizations_colour_profile_check`: dropped by name and re-added with
--     the nine names of `colourProfileSchema`
--     (`packages/shared/src/contracts/colour-profile.ts`), in the contract's
--     order. It lands with the profile values (the same PR), so a choice of a
--     new profile can never fail with 23514 between PRs.
--     `tests/f4.341-colour-profiles-nine-schema.test.ts` holds this list to the
--     contract. Migration 0125 (frozen) keeps the six-name original.
--   - No column changes. `varchar(32)` already fits the longest name
--     (`high-contrast`, 13 characters). No existing row changes: every stored
--     value is one of the six, and the six are in the new list.
--
-- POLICY. None: `bms.organizations` carries no policy (F4.16 / ADR 0043).
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0125 did. No GRANT.
--
-- Forward-only. Idempotent: the CHECK is dropped by name before it is added.

SET ROLE bms_owner;

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_colour_profile_check;

ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_colour_profile_check
  CHECK (colour_profile IN ('nexus', 'ocean', 'lagoon', 'indigo', 'graphite', 'high-contrast', 'forest', 'sand', 'navy-pop'));

RESET ROLE;
