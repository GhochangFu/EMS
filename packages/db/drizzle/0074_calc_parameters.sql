-- E4.1a / ADR 0070 decision 2 — the calc parameter vocabulary and the calc
-- parameter store.
--
-- A parameter is a NAMED NUMBER with a unit, a scope and a validity window:
-- an energy tariff, a grid carbon factor, a rated kW. A `bms-calc-v3` formula
-- reads one as `$key`; the evaluation host resolves it for the asset being
-- evaluated at the instant of the sweep. Two tables, because the NAME and the
-- VALUE have different owners:
--
--   - `bms.calc_parameter_keys` is the vocabulary — WHAT a key means. It is
--     GLOBAL, carries no `organization_id`, no RLS and no policy, for the
--     reason `0051` gives for `bms.asset_roles` and ADR 0049 decision 5 gives
--     for the stock catalog, applied here a third time: a stock template that
--     reads `$grid_carbon_factor_kgco2_per_kwh` must mean the same thing at
--     every site it is instantiated at. A per-tenant vocabulary would resolve
--     the same `$key` differently per tenant, and a nullable `organization_id`
--     with NULL meaning global is the shape ADR 0043 Amendment 5 rejected.
--   - `bms.calc_parameters` is the store — WHAT the value IS for one
--     organization, at one scope, over one window. It is a TENANT table:
--     `organization_id NOT NULL`, ENABLE + FORCE ROW LEVEL SECURITY and the
--     `tenant_isolation` policy in the creating migration (ADR 0043 decision
--     5, ADR 0045).
--
-- THE POLICY CHECKS BOTH NULLABLE PARENTS, `0073`'s shape verbatim, for the
-- reason `0050`'s security review PROVED on the running stack: Postgres runs
-- referential-integrity checks with row security OFF, so a foreign key never
-- consults the parent's policy, and an unchecked `location_id` or `asset_id`
-- would let a tenant scope its parameter to another organization's location
-- or asset. Each leg is `IS NULL OR EXISTS (...)`, so a NULL column is still
-- gated by the own-column check and cannot fail open. USING and WITH CHECK
-- carry the same three legs.
--
-- WHY `btree_gist`. Two rows of the same key and scope may not overlap in
-- time (ADR 0070 decision 2). The write path refuses an overlap with a 409
-- inside its transaction — the author-facing message, because RLS suppresses
-- a constraint violation's DETAIL and a bare 23P01 cannot name the clashing
-- dates. The `EXCLUDE USING gist` constraint below is the RACE-PROOF backstop
-- under that pre-read. A gist exclusion over uuid equality needs the
-- `btree_gist` operator classes. Measured at the E4.1a plan gate:
-- `pg_available_extensions` lists `btree_gist 1.7` on the compose image, not
-- installed. It is a trusted contrib extension shipped with Postgres, so it
-- is not a §9.4 dependency (ADR 0070 §Dependencies). It is provisioned by
-- `packages/db/src/roles.ts` (AGENTS.md §4.4: a migration never widens the
-- provisioning surface), which runs before `db:migrate` on every path.
--
-- The scope columns are NULLABLE and at most one is set: both NULL is the
-- organization scope. The exclusion coalesces each to the nil uuid so that
-- two organization-scope rows (both NULL) compare EQUAL — gist `=` on NULL
-- is not true, and without the coalesce two organization-scope rows would
-- never conflict.
--
-- `location_id` and `asset_id` CASCADE, for `0073`'s reason: a parameter
-- about a gone asset describes nothing. `organization_id` and `key` do not —
-- a vocabulary key that plant still references must refuse deletion loudly;
-- retire a key with `active = false` (`0051` step 3).
--
-- `calc_parameters_value_finite_check` is `0031`'s form on `point_values`,
-- NOT `value = value`: `0031`'s header records that in Postgres `NaN = NaN`
-- is TRUE and `NaN` sorts above `'Infinity'`, so the equality form is a
-- no-op. `value > '-Infinity' AND value < 'Infinity'` rejects NaN and both
-- infinities. This is decision 2's "no value that is not a number" held at
-- the store, so the resolver never has to.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING, AND WHY NO `GRANT` IS WRITTEN:
-- `0041` lines 112-113's `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner` fire
-- only for objects created by that role. Without the bracket both tables
-- would be owned by `bms_app`, the default privileges would never fire, and
-- `bms_tenant` / `bms_fleet` could not read them — a failure that surfaces
-- "one endpoint at a time" (`0039`). A hand-written GRANT would be redundant
-- and would hide a future breakage of the bracket (`0050`, `0051`).
--
-- The twelve stock keys are seeded HERE, by the migration, with a bare
-- `ON CONFLICT DO NOTHING` (the `0030`/`0051`/`0060` rule): the insert joins
-- nothing `pnpm db:seed` creates, so it is safe inside `db:migrate`, which
-- always runs first. Do not add a mirror seeding path to `seed.ts`. No stock
-- key ships with a VALUE (ADR 0070 Context 3) — a `$key` with no row in
-- scope is a counted `parameter_unset` refusal, never a default.
--
-- Forward-only and idempotent. Indexed 0074: `0051`-`0073` are committed and
-- frozen, and the journal `when` is strictly greater than `0073`'s
-- 1789575341238, or drizzle applies nothing and every check downstream passes
-- against a schema short two tables (`0024`'s header records this).

SET ROLE bms_owner;

-- 1. The vocabulary, as data — a lookup table, not a z.enum and not a CHECK.
--
--    `asset_roles`'s shape (`0051` step 1) plus `unit` and `description`.
--    `code` is the primary key because templates round-trip through JSON,
--    which code references survive and uuids do not. Its charset is NARROWER
--    than ADR 0065's catalog class: `$key` lexes as `$` then
--    `[A-Za-z_][A-Za-z0-9_]*`, so a `-` could never be written (`$a-b` is
--    `$a - b`), and the ADR's own snake_case naming rule is made mechanical.
CREATE TABLE IF NOT EXISTS bms.calc_parameter_keys (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  unit varchar(32),
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calc_parameter_keys_code_charset_check CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- 2. The twelve stock keys, ADR 0070 decision 2, fixed at the E4.1a plan gate.
--
--    Units are currency-neutral (`/kWh`, `/kL`) per decision 2's naming rule;
--    `E4.1c` adds `organizations.currency` for display. Spaced by ten inside
--    a band, `0051`'s convention: tariffs 110-130, factors 210, baselines
--    310-330, ratings 410-440, bands 510.
INSERT INTO bms.calc_parameter_keys (code, label, unit, description, sort_order) VALUES
  ('energy_tariff_per_kwh',            'Energy tariff',            '/kWh',       'Cost of one kilowatt-hour of grid energy, in the organization''s currency.',        110),
  ('water_tariff_per_kl',              'Water tariff',             '/kL',        'Cost of one kilolitre of supplied water, in the organization''s currency.',        120),
  ('effluent_tariff_per_kl',           'Effluent tariff',          '/kL',        'Cost of discharging one kilolitre of effluent, in the organization''s currency.',  130),
  ('grid_carbon_factor_kgco2_per_kwh', 'Grid carbon factor',       'kgCO2/kWh',  'Kilograms of CO2 emitted per kilowatt-hour drawn from the grid.',                  210),
  ('energy_baseline_kwh_per_day',      'Energy baseline',          'kWh/day',    'Reference daily energy consumption against which savings are measured.',           310),
  ('water_baseline_kl_per_day',        'Water baseline',           'kL/day',     'Reference daily water consumption against which savings are measured.',            320),
  ('chemical_baseline_kg_per_day',     'Chemical baseline',        'kg/day',     'Reference daily chemical dosing against which savings are measured.',              330),
  ('rated_kw',                         'Rated power',              'kW',         'Nameplate power rating of the asset.',                                             410),
  ('installed_kwp',                    'Installed PV capacity',    'kWp',        'Installed photovoltaic peak capacity.',                                            420),
  ('contract_demand_kva',              'Contract demand',          'kVA',        'Contracted maximum demand with the utility.',                                      430),
  ('tank_capacity_l',                  'Tank capacity',            'L',          'Nominal capacity of the tank.',                                                    440),
  ('tariff_pf_band',                   'Tariff power-factor band', NULL,         'Power-factor threshold below which the tariff applies a penalty.',                 510)
ON CONFLICT DO NOTHING;

-- 3. The store. Nearest scope wins at resolution (asset, then location, then
--    organization) among rows whose `[effective_from, effective_to)` contains
--    the instant; `effective_to IS NULL` is open-ended.
CREATE TABLE IF NOT EXISTS bms.calc_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  key varchar(64) NOT NULL REFERENCES bms.calc_parameter_keys(code),
  location_id uuid REFERENCES bms.locations(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES bms.assets(id) ON DELETE CASCADE,
  value double precision NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calc_parameters_scope_check
    CHECK (((location_id IS NOT NULL)::int + (asset_id IS NOT NULL)::int) <= 1),
  CONSTRAINT calc_parameters_validity_check
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT calc_parameters_value_finite_check
    CHECK (value > '-Infinity'::float8 AND value < 'Infinity'::float8),
  CONSTRAINT calc_parameters_no_overlap EXCLUDE USING gist (
    organization_id WITH =,
    key WITH =,
    (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    (coalesce(asset_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
);

-- 4. The resolver's lookup and the two cascades.
--
--    Not CONCURRENTLY: it cannot run in a transaction block and the drizzle
--    migrator wraps every file.
CREATE INDEX IF NOT EXISTS calc_parameters_org_key_idx ON bms.calc_parameters (organization_id, key);
CREATE INDEX IF NOT EXISTS calc_parameters_location_idx ON bms.calc_parameters (location_id);
CREATE INDEX IF NOT EXISTS calc_parameters_asset_idx ON bms.calc_parameters (asset_id);

-- 5. Tenant isolation, with FORCE so the owner role is bound too (ADR 0045).
ALTER TABLE bms.calc_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.calc_parameters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.calc_parameters;
CREATE POLICY tenant_isolation ON bms.calc_parameters
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = calc_parameters.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_id IS NULL OR EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = calc_parameters.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND (location_id IS NULL OR EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = calc_parameters.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
    AND (asset_id IS NULL OR EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = calc_parameters.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid))
  );

RESET ROLE;
