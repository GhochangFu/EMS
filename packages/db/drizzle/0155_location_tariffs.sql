-- F4.365 / ADR 0134 decisions 3 and 8 — an organization's own tariff
-- versions, and the mapping of a location to a tariff line.
--
-- Three TENANT tables: `organization_id NOT NULL`, ENABLE + FORCE ROW LEVEL
-- SECURITY and a `tenant_isolation` policy in this creating migration
-- (ADR 0043 decision 5, ADR 0045).
--
-- `org_tariff_categories` / `org_tariff_slabs` mirror `0154`'s catalog plus
-- `organization_id`, `created_by` and a required `reason`. A row is either a
-- REVISION of a catalog line (same `key`, a new first-of-month
-- `effective_from`) or a CUSTOM line (`key` starting `custom:`). For a billing
-- month the resolver takes, among the catalog's versions and this
-- organization's versions of the mapped key, the latest `effective_from` on
-- or before the month's first day; on the same date the organization's
-- version wins (decision 8). `created_by` is a plain nullable key because a
-- global admin's user row has no organization.
--
-- The slabs carry `organization_id` and a COMPOSITE foreign key to
-- `(id, organization_id)` of their category, so a slab can never hang under
-- another organization's version — the FK runs with row security OFF, and the
-- composite key makes the pairing structural rather than policy-checked.
--
-- `location_tariffs` maps a location to a tariff LINE (`tariff_key`), not to
-- one version, so a new revision applies from its date with no remap. Its
-- policy checks BOTH parents, `0074`'s shape: the location leg (decision 3)
-- and the billing-meter asset leg. Postgres runs referential-integrity checks
-- with row security OFF (`0050`'s proof), so without the asset leg a tenant
-- could name another organization's meter as its billing meter. ADR 0134
-- names only the location leg; the asset leg is this migration's addition.
-- `tariff_key` is deliberately NOT a foreign key: a line is a key across two
-- tables (catalog and organization), and a mapping may be written before an
-- organization's custom version exists. The write path validates it.
--
-- `location_tariffs_no_overlap` forbids two mappings of one location whose
-- `[effective_from, effective_to)` overlap. `btree_gist` is provisioned by
-- `packages/db/src/roles.ts` (`0074`).
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING, AND WHY NO `GRANT` IS WRITTEN:
-- as `0154`.
--
-- Forward-only and idempotent.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.org_tariff_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
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
  reason varchar(500) NOT NULL,
  created_by uuid REFERENCES bms.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_tariff_categories_org_key_effective_from_key UNIQUE (organization_id, key, effective_from),
  CONSTRAINT org_tariff_categories_id_org_key UNIQUE (id, organization_id),
  CONSTRAINT org_tariff_categories_energy_unit_check CHECK (energy_unit IN ('kwh', 'kvah')),
  CONSTRAINT org_tariff_categories_fixed_basis_check CHECK (fixed_basis IN (
    'per_kw_month', 'per_kva_month', 'per_hp_month',
    'per_connection_month', 'per_connection_bimonth', 'none')),
  CONSTRAINT org_tariff_categories_data_status_check CHECK (data_status IN ('official', 'secondary', 'indicative')),
  CONSTRAINT org_tariff_categories_effective_from_month_start_check
    CHECK (effective_from = date_trunc('month', effective_from)::date),
  CONSTRAINT org_tariff_categories_key_trim_check CHECK (key = btrim(key) AND key <> ''),
  CONSTRAINT org_tariff_categories_reason_check CHECK (length(btrim(reason)) >= 3),
  CONSTRAINT org_tariff_categories_source_url_check CHECK (source_url IS NULL OR source_url ~ '^https?://')
);

CREATE INDEX IF NOT EXISTS org_tariff_categories_org_key_idx ON bms.org_tariff_categories (organization_id, key);

CREATE TABLE IF NOT EXISTS bms.org_tariff_slabs (
  category_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  slab_no smallint NOT NULL,
  from_units numeric(14,3) NOT NULL,
  to_units numeric(14,3),
  energy_rate numeric(12,4) NOT NULL,
  fixed_rate numeric(12,4) NOT NULL DEFAULT 0,
  wheeling_rate numeric(12,4) NOT NULL DEFAULT 0,
  notes varchar(500),
  PRIMARY KEY (category_id, slab_no),
  CONSTRAINT org_tariff_slabs_category_fk FOREIGN KEY (category_id, organization_id)
    REFERENCES bms.org_tariff_categories (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT org_tariff_slabs_slab_no_check CHECK (slab_no >= 1),
  CONSTRAINT org_tariff_slabs_bounds_check CHECK (from_units >= 0 AND (to_units IS NULL OR to_units >= from_units)),
  CONSTRAINT org_tariff_slabs_rates_check CHECK (energy_rate >= 0 AND fixed_rate >= 0 AND wheeling_rate >= 0)
);

CREATE TABLE IF NOT EXISTS bms.location_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  location_id uuid NOT NULL REFERENCES bms.locations(id) ON DELETE CASCADE,
  tariff_key varchar(200) NOT NULL,
  billing_meter_asset_id uuid NOT NULL REFERENCES bms.assets(id) ON DELETE CASCADE,
  sanctioned_load numeric(12,3) NOT NULL,
  sanctioned_load_unit varchar(8) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_tariffs_sanctioned_load_check CHECK (sanctioned_load >= 0),
  CONSTRAINT location_tariffs_sanctioned_load_unit_check CHECK (sanctioned_load_unit IN ('kw', 'kva', 'hp')),
  CONSTRAINT location_tariffs_validity_check CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT location_tariffs_month_start_check CHECK (
    effective_from = date_trunc('month', effective_from)::date
    AND (effective_to IS NULL OR effective_to = date_trunc('month', effective_to)::date)),
  CONSTRAINT location_tariffs_no_overlap EXCLUDE USING gist (
    location_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS location_tariffs_org_idx ON bms.location_tariffs (organization_id);
CREATE INDEX IF NOT EXISTS location_tariffs_meter_idx ON bms.location_tariffs (billing_meter_asset_id);

ALTER TABLE bms.org_tariff_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.org_tariff_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.org_tariff_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.org_tariff_slabs FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.location_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.location_tariffs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.org_tariff_categories;
CREATE POLICY tenant_isolation ON bms.org_tariff_categories
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.org_tariff_slabs;
CREATE POLICY tenant_isolation ON bms.org_tariff_slabs
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.location_tariffs;
CREATE POLICY tenant_isolation ON bms.location_tariffs
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = location_tariffs.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = location_tariffs.billing_meter_asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.locations l
             WHERE l.id = location_tariffs.location_id
               AND l.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = location_tariffs.billing_meter_asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

RESET ROLE;
