-- F4.365 / ADR 0134 decision 1 — the global utility tariff catalog.
--
-- A published discom tariff means the same thing for every tenant, so these
-- two tables are GLOBAL vocabulary: no `organization_id`, no RLS, no policy —
-- the reasoning `0074` gives for `bms.calc_parameter_keys` and `0085` for
-- `bms.location_types`. An organization's own revisions and custom tariffs
-- live in `0155`'s tenant tables, never here (ADR 0043 Amendment 5 rejects
-- a nullable `organization_id` meaning "global").
--
-- A tariff LINE is its `key` (the workbook's Category Key). One row of
-- `tariff_categories` is one VERSION of a line: `(key, effective_from)` is
-- unique. Every `effective_from` is the first of a month (plan D8), so one
-- bill never mixes two rate sets.
--
-- NO ROWS ARE WRITTEN HERE. The catalog is data: `pnpm db:seed` upserts the
-- committed `packages/db/src/tariff-catalog.json` as `bms_owner`, and
-- `pnpm --filter api tariffs:import --apply` writes as `bms_fleet` (plan D2,
-- D3). `bms_tenant` may only read: the REVOKE below and the proof after
-- `RESET ROLE` are `0085`'s shape.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING, AND WHY NO `GRANT` IS WRITTEN:
-- `0041`'s `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner` fire only for objects
-- that role creates; a hand-written GRANT would hide a future breakage of the
-- bracket (`0050`, `0051`, `0074`).
--
-- Rates are `numeric`, in the organization's currency (ADR 0070 `E4.1c`).
-- `segment`, `supply` and `ownership` are open text: the workbook spells them
-- freely ("HT 11 kV", "LT/HT") and nothing branches on them.
--
-- Forward-only and idempotent.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.tariff_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(200) NOT NULL,
  area_id varchar(16) NOT NULL,
  state varchar(100) NOT NULL,
  discoms varchar(300) NOT NULL,
  ownership varchar(100) NOT NULL,
  code varchar(100) NOT NULL,
  name varchar(200) NOT NULL,
  segment varchar(100) NOT NULL,
  supply varchar(100) NOT NULL,
  energy_unit varchar(8) NOT NULL,
  fixed_basis varchar(32) NOT NULL,
  data_status varchar(16) NOT NULL,
  tariff_order varchar(300),
  effective_from date NOT NULL,
  source_url varchar(500),
  notes varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tariff_categories_key_effective_from_key UNIQUE (key, effective_from),
  CONSTRAINT tariff_categories_energy_unit_check CHECK (energy_unit IN ('kwh', 'kvah')),
  CONSTRAINT tariff_categories_fixed_basis_check CHECK (fixed_basis IN (
    'per_kw_month', 'per_kva_month', 'per_hp_month',
    'per_connection_month', 'per_connection_bimonth', 'none')),
  CONSTRAINT tariff_categories_data_status_check CHECK (data_status IN ('official', 'secondary', 'indicative')),
  CONSTRAINT tariff_categories_effective_from_month_start_check
    CHECK (effective_from = date_trunc('month', effective_from)::date),
  CONSTRAINT tariff_categories_key_not_custom_check CHECK (key NOT LIKE 'custom:%'),
  CONSTRAINT tariff_categories_key_trim_check CHECK (key = btrim(key) AND key <> ''),
  CONSTRAINT tariff_categories_source_url_check CHECK (source_url IS NULL OR source_url ~ '^https?://')
);

CREATE INDEX IF NOT EXISTS tariff_categories_state_idx ON bms.tariff_categories (state);

CREATE TABLE IF NOT EXISTS bms.tariff_slabs (
  category_id uuid NOT NULL REFERENCES bms.tariff_categories(id) ON DELETE CASCADE,
  slab_no smallint NOT NULL,
  from_units numeric(14,3) NOT NULL,
  to_units numeric(14,3),
  energy_rate numeric(12,4) NOT NULL,
  fixed_rate numeric(12,4) NOT NULL DEFAULT 0,
  wheeling_rate numeric(12,4) NOT NULL DEFAULT 0,
  notes varchar(500),
  PRIMARY KEY (category_id, slab_no),
  CONSTRAINT tariff_slabs_slab_no_check CHECK (slab_no >= 1),
  CONSTRAINT tariff_slabs_bounds_check CHECK (from_units >= 0 AND (to_units IS NULL OR to_units >= from_units)),
  CONSTRAINT tariff_slabs_rates_check CHECK (energy_rate >= 0 AND fixed_rate >= 0 AND wheeling_rate >= 0)
);

REVOKE INSERT, UPDATE, DELETE ON bms.tariff_categories FROM bms_tenant;
REVOKE INSERT, UPDATE, DELETE ON bms.tariff_slabs FROM bms_tenant;

RESET ROLE;

-- The proof, as the migrator's own superuser role — the `0085` shape.
-- `has_table_privilege` follows role membership, so a privilege `bms_tenant`
-- inherits from another role is caught here rather than surviving a revoke
-- that looked complete.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms.tariff_categories', 'bms.tariff_slabs'] LOOP
    IF has_table_privilege('bms_tenant', t, 'INSERT')
       OR has_table_privilege('bms_tenant', t, 'UPDATE')
       OR has_table_privilege('bms_tenant', t, 'DELETE') THEN
      RAISE EXCEPTION 'migration 0154: bms_tenant still holds INSERT, UPDATE or DELETE on %', t
        USING HINT = 'The REVOKE ran as bms_owner, so the privilege arrives by another route — '
          || 'most likely a role bms_tenant is a member of.';
    END IF;
    IF NOT has_table_privilege('bms_tenant', t, 'SELECT') THEN
      RAISE EXCEPTION 'migration 0154: bms_tenant lacks SELECT on %', t;
    END IF;
    IF NOT has_table_privilege('bms_fleet', t, 'SELECT') THEN
      RAISE EXCEPTION 'migration 0154: bms_fleet lacks SELECT on %', t
        USING HINT = 'The bill and cost reads join the catalog on the fleet pool (plan D12).';
    END IF;
  END LOOP;
END $$;
