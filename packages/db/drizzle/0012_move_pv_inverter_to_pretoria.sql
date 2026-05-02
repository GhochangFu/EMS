WITH target_location AS (
  SELECT id
  FROM bms.locations
  WHERE name = 'SMOC Pretoria North'
  LIMIT 1
),
target_asset AS (
  UPDATE bms.assets AS a
  SET site_name = 'SMOC Pretoria North',
      location_id = (SELECT id FROM target_location)
  WHERE a.code = 'PV-INV-01'
    AND EXISTS (SELECT 1 FROM target_location)
  RETURNING a.id, a.location_id
),
removed_old_groups AS (
  DELETE FROM bms.asset_group_members AS agm
  USING target_asset AS ta,
        bms.asset_groups AS ag
  WHERE agm.asset_id = ta.id
    AND ag.id = agm.asset_group_id
    AND ag.location_id <> ta.location_id
  RETURNING agm.asset_id
),
target_group AS (
  INSERT INTO bms.asset_groups (location_id, code, name, description)
  SELECT id, 'electrical', 'Electrical', 'Seeded operational asset group for scoped access demos.'
  FROM target_location
  ON CONFLICT (location_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description
  RETURNING id
)
INSERT INTO bms.asset_group_members (asset_group_id, asset_id)
SELECT target_group.id, target_asset.id
FROM target_group
CROSS JOIN target_asset
ON CONFLICT (asset_group_id, asset_id) DO NOTHING;
