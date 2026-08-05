import pg from "pg";

/**
 * Fixtures for states the schema permits but the rest of the seed never
 * produces (backlog `F4.10`).
 *
 * Two access-control predicates were empirically unprovable before this ran:
 *
 * - `scopeFromSource` filters on `locations.active = true` in all four
 *   branches, but every seeded location was active, so dropping the filter
 *   changed no test result.
 * - ADR 0018 made `assets.rtu_id` nullable so an asset can exist without a
 *   gateway, but `assignEskomAssetRtus` backfills every ESKOM asset and the PHE
 *   seed wires every PHE one — so the state the ADR exists to permit occurred
 *   zero times, and a scope query that started joining through `bms.rtus` would
 *   have gone unnoticed.
 *
 * A test whose fixture cannot distinguish pass from vacuum is the failure mode
 * this repository keeps shipping. These two rows close both, and neither is
 * artificial: a decommissioned site and a hand-read meter are ordinary in a
 * BMS, and the hand-read meter is precisely what `F1.8` (manual time-series
 * entry) and `F1.9` (bulk import) are for.
 */

/** Codes are referenced by `F4.10`'s assertions and by `assignEskomAssetRtus`. */
export const DECOMMISSIONED_LOCATION_CODE = "ESK-DECOMM-01";
export const MANUAL_ASSET_CODE = "ESK-MANUAL-01";

export async function seedAccessControlFixtures(pool: pg.Pool): Promise<void> {
  const org = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
  );
  const organizationId = org.rows[0]?.id;
  if (!organizationId) {
    return;
  }

  // An inactive location. Every read-scope branch filters it out; without one,
  // `WHERE active = true` and no predicate at all return identical rows.
  await pool.query(
    `
    INSERT INTO bms.locations
      (organization_id, code, slug, name, type, province, latitude, longitude, active)
    VALUES ($1, $2, 'esk-decomm-01', 'Decommissioned Substation', 'smoc_campus',
            'Gauteng', -26.2041, 28.0473, false)
    ON CONFLICT (organization_id, code) DO UPDATE SET active = false
    `,
    [organizationId, DECOMMISSIONED_LOCATION_CODE],
  );

  // A gateway-less asset in an ACTIVE location, so it is inside every scope
  // that its location is inside — which is the point. Putting it in the
  // inactive location would make the two fixtures mask each other.
  const host = await pool.query<{ id: string }>(
    `
    SELECT l.id FROM bms.locations l
     WHERE l.organization_id = $1 AND l.active = true AND l.code <> $2
     ORDER BY l.code LIMIT 1
    `,
    [organizationId, DECOMMISSIONED_LOCATION_CODE],
  );
  const locationId = host.rows[0]?.id;
  if (!locationId) {
    return;
  }

  // `meta.sourceKind = 'manual'` is what exempts it from the RTU backfill on
  // every subsequent `db:seed`. Without that, run 2 would wire it and the
  // fixture would silently stop being a fixture.
  const asset = await pool.query<{ id: string }>(
    `
    INSERT INTO bms.assets (code, name, site_name, location_id, rtu_id, domain, active, meta)
    VALUES ($1, 'Manual Read Meter 01', 'Decommissioned Substation', $2, NULL, 'electrical', true,
            '{"sourceKind":"manual","note":"F4.10 fixture: readings entered by hand, no gateway"}'::jsonb)
    ON CONFLICT (code) DO UPDATE
       SET rtu_id = NULL,
           location_id = EXCLUDED.location_id,
           meta = EXCLUDED.meta
    RETURNING id
    `,
    [MANUAL_ASSET_CODE, locationId],
  );
  const assetId = asset.rows[0]?.id;
  if (!assetId) {
    return;
  }

  // One point, so the asset is not merely gateway-less but demonstrably
  // *readable* without a gateway. ADR 0018's CHECK requires a `manual` point to
  // carry no rtu_id, which is exactly the pairing this proves.
  const pointKey = await pool.query<{ code: string; unit: string | null }>(
    `SELECT code, unit FROM bms.point_keys
      WHERE organization_id = $1 AND active = true ORDER BY code LIMIT 1`,
    [organizationId],
  );
  const key = pointKey.rows[0];
  if (!key) {
    return;
  }
  await pool.query(
    `
    INSERT INTO bms.asset_points (asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active)
    VALUES ($1, $2, $3, NULL, 'manual', $4, true)
    ON CONFLICT (asset_id, point_key) DO UPDATE
       SET rtu_id = NULL, source_kind = 'manual'
    `,
    [assetId, key.code, `MANUAL_${key.code.toUpperCase()}`, key.unit],
  );
}
