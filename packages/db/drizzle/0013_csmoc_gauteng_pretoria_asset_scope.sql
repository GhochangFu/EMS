WITH csmoc_gauteng AS (
  SELECT id
  FROM bms.locations
  WHERE name = 'CSMOC Gauteng'
  LIMIT 1
)
UPDATE bms.assets AS a
SET site_name = 'CSMOC Gauteng',
    location_id = (SELECT id FROM csmoc_gauteng),
    meta = COALESCE(a.meta, '{}'::jsonb) || '{"telemetryEnabled": true}'::jsonb
WHERE a.code IN (
    'TX-L1-MV',
    'SWG-MDB1',
    'UPS-A',
    'CH-CRAC-101',
    'CH-CRAC-102',
    'CH-CRAC-103',
    'CH-CRAC-104',
    'PV-INV-01'
  )
  AND EXISTS (SELECT 1 FROM csmoc_gauteng);
--> statement-breakpoint
WITH smoc_pretoria AS (
  SELECT id
  FROM bms.locations
  WHERE name = 'SMOC Pretoria North'
  LIMIT 1
),
dummy_assets (code, name, domain, meta) AS (
  VALUES
    ('PTA-DMY-MDB-01', 'Pretoria North Demo MDB 01', 'electrical', '{"telemetryEnabled": false, "demoOnly": true}'::jsonb),
    ('PTA-DMY-UPS-01', 'Pretoria North Demo UPS 01', 'electrical', '{"telemetryEnabled": false, "demoOnly": true}'::jsonb),
    ('PTA-DMY-CRAC-01', 'Pretoria North Demo CRAC 01', 'hvac', '{"telemetryEnabled": false, "demoOnly": true}'::jsonb),
    ('PTA-DMY-CRAC-02', 'Pretoria North Demo CRAC 02', 'hvac', '{"telemetryEnabled": false, "demoOnly": true}'::jsonb),
    ('PTA-DMY-RACK-01', 'Pretoria North Demo Network Rack 01', 'it', '{"telemetryEnabled": false, "demoOnly": true}'::jsonb),
    ('PTA-DMY-ENV-01', 'Pretoria North Demo Environment Sensor 01', 'environment', '{"telemetryEnabled": false, "demoOnly": true}'::jsonb)
)
INSERT INTO bms.assets (code, name, site_name, location_id, domain, meta)
SELECT
  dummy_assets.code,
  dummy_assets.name,
  'SMOC Pretoria North',
  smoc_pretoria.id,
  dummy_assets.domain,
  dummy_assets.meta
FROM dummy_assets
CROSS JOIN smoc_pretoria
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    site_name = EXCLUDED.site_name,
    location_id = EXCLUDED.location_id,
    domain = EXCLUDED.domain,
    meta = EXCLUDED.meta;
--> statement-breakpoint
DELETE FROM bms.asset_group_members AS agm
USING bms.asset_groups AS ag,
      bms.assets AS a
WHERE agm.asset_group_id = ag.id
  AND agm.asset_id = a.id
  AND a.location_id IS NOT NULL
  AND ag.location_id <> a.location_id;
--> statement-breakpoint
WITH scoped_assets AS (
  SELECT
    id,
    code,
    location_id,
    CASE
      WHEN domain = 'hvac' THEN 'hvac'
      WHEN domain = 'it' THEN 'it-rack'
      WHEN domain = 'environment' THEN 'environment'
      WHEN code LIKE '%UPS%' OR code LIKE '%BATT%' THEN 'ups-battery'
      ELSE 'electrical'
    END AS group_code
  FROM bms.assets
  WHERE location_id IS NOT NULL
    AND code IN (
      'TX-L1-MV',
      'SWG-MDB1',
      'UPS-A',
      'CH-CRAC-101',
      'CH-CRAC-102',
      'CH-CRAC-103',
      'CH-CRAC-104',
      'PV-INV-01',
      'PTA-DMY-MDB-01',
      'PTA-DMY-UPS-01',
      'PTA-DMY-CRAC-01',
      'PTA-DMY-CRAC-02',
      'PTA-DMY-RACK-01',
      'PTA-DMY-ENV-01'
    )
),
groups_to_upsert AS (
  SELECT DISTINCT
    location_id,
    group_code,
    CASE
      WHEN group_code = 'it-rack' THEN 'IT & Rack Load'
      WHEN group_code = 'ups-battery' THEN 'UPS & Battery'
      WHEN group_code = 'hvac' THEN 'Hvac'
      WHEN group_code = 'environment' THEN 'Environment'
      ELSE 'Electrical'
    END AS group_name
  FROM scoped_assets
),
upserted_groups AS (
  INSERT INTO bms.asset_groups (location_id, code, name, description)
  SELECT
    location_id,
    group_code,
    group_name,
    'Seeded operational asset group for scoped access demos.'
  FROM groups_to_upsert
  ON CONFLICT (location_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description
  RETURNING id, location_id, code
)
INSERT INTO bms.asset_group_members (asset_group_id, asset_id)
SELECT
  upserted_groups.id,
  scoped_assets.id
FROM scoped_assets
JOIN upserted_groups
  ON upserted_groups.location_id = scoped_assets.location_id
 AND upserted_groups.code = scoped_assets.group_code
ON CONFLICT (asset_group_id, asset_id) DO NOTHING;
