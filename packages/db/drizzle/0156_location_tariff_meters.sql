-- F4.373 / ADR 0134 Amendment 3 — several billing meters on one tariff mapping.
--
-- One TENANT table, `bms.location_tariff_meters`: the meters whose register
-- deltas add up to a mapping's bill (a PHEWB station has two MFM meters on two
-- RTUs and the discom sends ONE bill for both). `organization_id NOT NULL`,
-- ENABLE + FORCE ROW LEVEL SECURITY and a `tenant_isolation` policy in this
-- creating migration (ADR 0043 decision 5, ADR 0045).
--
-- `bms.location_tariffs.billing_meter_asset_id` STAYS and is the first meter of
-- the list (Amendment 3 item 1), so nothing that reads it breaks. The write
-- path keeps the two in step inside one transaction.
--
-- The row's mapping is a COMPOSITE foreign key to `(id, organization_id)` of
-- `location_tariffs`, so a meter row can never hang under another
-- organization's mapping — the FK runs with row security OFF, and the
-- composite key makes the pairing structural rather than policy-checked (the
-- `org_tariff_slabs` shape, `0155`). `location_tariffs` gains the
-- `UNIQUE (id, organization_id)` that key needs, added only when absent.
--
-- The policy checks the row's own `organization_id` AND the meter asset's
-- organization, in USING and WITH CHECK. Postgres runs referential-integrity
-- checks with row security OFF (`0050`'s proof), so without the asset leg a
-- tenant could name another organization's meter (`0155`'s reasoning for
-- `location_tariffs`' own asset leg).
--
-- `asset_id` cascades with its asset, as `billing_meter_asset_id` does.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING, AND WHY NO `GRANT` IS WRITTEN:
-- as `0154`. `0041`'s default privileges give both pool roles the four DML
-- privileges on a table bms_owner creates.
--
-- THE BACKFILL RUNS AFTER RESET ROLE (the `0145` shape). Inside SET ROLE
-- bms_owner, FORCE row security would make the `SELECT … FROM
-- bms.location_tariffs` match zero rows and raise nothing. The migrator's own
-- role (a superuser) bypasses it, and the role is checked first so a wrong
-- role fails loudly. The copy reads only `location_tariffs`, a table this
-- feature owns, and `ON CONFLICT DO NOTHING` makes a second run a no-op.
--
-- Forward-only and idempotent.

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'location_tariffs_id_org_key'
       AND conrelid = 'bms.location_tariffs'::regclass
  ) THEN
    ALTER TABLE bms.location_tariffs
      ADD CONSTRAINT location_tariffs_id_org_key UNIQUE (id, organization_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS bms.location_tariff_meters (
  location_tariff_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES bms.assets(id) ON DELETE CASCADE,
  PRIMARY KEY (location_tariff_id, asset_id),
  CONSTRAINT location_tariff_meters_mapping_fk FOREIGN KEY (location_tariff_id, organization_id)
    REFERENCES bms.location_tariffs (id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS location_tariff_meters_asset_idx ON bms.location_tariff_meters (asset_id);
CREATE INDEX IF NOT EXISTS location_tariff_meters_org_idx ON bms.location_tariff_meters (organization_id);

ALTER TABLE bms.location_tariff_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.location_tariff_meters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.location_tariff_meters;
CREATE POLICY tenant_isolation ON bms.location_tariff_meters
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = location_tariff_meters.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = location_tariff_meters.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

RESET ROLE;

-- The backfill, as the migrator's superuser role (see the header).
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION
      'migration 0156: the location_tariff_meters backfill must run as a role that bypasses row security, not as %', current_user;
  END IF;
END
$$;

INSERT INTO bms.location_tariff_meters (location_tariff_id, organization_id, asset_id)
SELECT id, organization_id, billing_meter_asset_id FROM bms.location_tariffs
ON CONFLICT DO NOTHING;

-- The proof: row security enabled and forced, the owner, the policy's two legs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms' AND c.relname = 'location_tariff_meters'
       AND c.relrowsecurity AND c.relforcerowsecurity
       AND c.relowner = 'bms_owner'::regrole
  ) THEN
    RAISE EXCEPTION 'migration 0156: bms.location_tariff_meters is not owned by bms_owner with row security enabled and forced';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'bms' AND p.tablename = 'location_tariff_meters' AND p.policyname = 'tenant_isolation'
       AND p.qual LIKE '%app.current_organization%' AND p.qual LIKE '%bms.assets%'
       AND p.with_check LIKE '%app.current_organization%' AND p.with_check LIKE '%bms.assets%'
  ) THEN
    RAISE EXCEPTION 'migration 0156: tenant_isolation must check the organization and the meter asset in USING and WITH CHECK';
  END IF;
END
$$;
