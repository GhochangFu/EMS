-- F4.364 / ADR 0133 decision 1 — whether an organization's locations show
-- energy, and the location card's first figure.
--
--   - `bms.organizations.energy_features`: `auto` (shown where a location has
--     a `kw` value in the last 30 days), `on` or `off`. `NOT NULL DEFAULT
--     'auto'`, so an organization with energy data keeps today's view.
--     `varchar(8)`: the longest value, `auto`, is 4 characters.
--   - `bms.organizations.card_primary_metric`: `auto`, `kw`, `health`,
--     `critical_alarms` or `none`. `NOT NULL DEFAULT 'auto'`. `varchar(16)`:
--     the longest value, `critical_alarms`, is 15 characters.
--   - `organizations_energy_features_check` and
--     `organizations_card_primary_metric_check`: the closed lists.
--     `tests/f4.364-organization-energy-features-schema.test.ts` holds them to
--     `ENERGY_FEATURES` and `CARD_PRIMARY_METRICS`
--     (`packages/shared/src/contracts/energy-features.ts`). A new value is a
--     contract change, an amendment to ADR 0133 and a new migration.
--
-- POLICY. None: `bms.organizations` carries no policy (F4.16 / ADR 0043), and
-- a column changes no grant. The API gates the write (`PATCH
-- /admin/organizations/:id`, global admin only, ADR 0133 plan ruling Q2).
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0125 did for `colour_profile`. No GRANT.
--
-- Forward-only. Idempotent: each column is `IF NOT EXISTS`, and each CHECK is
-- dropped by name before it is added.

SET ROLE bms_owner;

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS energy_features varchar(8) NOT NULL DEFAULT 'auto';

ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS card_primary_metric varchar(16) NOT NULL DEFAULT 'auto';

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_energy_features_check;

ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_energy_features_check
  CHECK (energy_features IN ('auto', 'on', 'off'));

ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_card_primary_metric_check;

ALTER TABLE bms.organizations
  ADD CONSTRAINT organizations_card_primary_metric_check
  CHECK (card_primary_metric IN ('auto', 'kw', 'health', 'critical_alarms', 'none'));

RESET ROLE;
