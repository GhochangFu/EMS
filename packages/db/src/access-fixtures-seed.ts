import pg from "pg";

import { STOCK_POINT_KEY_CODES } from "./point-keys-seed";

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

/**
 * The hand-read meter's one point. **A NAME, NEVER A POSITION.**
 *
 * This was `ORDER BY created_at, code LIMIT 1` over the whole of
 * `bms.point_keys` until `F3.42`'s post-merge sweep, and the row it returned
 * depended on the order the database happened to be filled in. `F3.39` removed
 * the organization predicate that used to bound it, and `seedPheCatalog` runs
 * before `seedPointKeyCatalog`, so a FRESH database gave this fixture
 * `battery_charge_pct` — a PHE pilot code that carried a NULL unit until
 * `F2.11` promoted it and filled `"%"` — while every
 * database seeded earlier kept `backup_min`. Measured both ways on two
 * databases. No error is raised in either case, which is exactly why a
 * cold-start check passed over it, and the row is persistent, so every shipped
 * database carries whichever answer its own history produced.
 *
 * **Why this code and not simply the first one in the catalog.** `ESK-MANUAL-01`
 * has `domain = 'electrical'`, so the simulator's `ELECTRICAL_POINT_KEYS` are
 * all written to it by `seedRuledPointCatalog`. Taking the catalog's first code
 * hands the fixture `voltage_l1_v` and it wins the upsert race, leaving the
 * ruled-point catalog one row short and the "hand-read meter" holding a point
 * the simulator drives — measured, not predicted. `backup_min` is stock
 * vocabulary (`CONTROL_ROOM_UPS_POINT_KEYS`) that no electrical asset's
 * simulator writes, so the fixture owns its point outright. It is also what the
 * reference database has always had, so naming it changes no existing row.
 */
export const MANUAL_POINT_KEY = "backup_min";

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
    INSERT INTO bms.assets (code, name, site_name, location_id, rtu_id, domain, active, meta, organization_id)
    VALUES ($1, 'Manual Read Meter 01', 'Decommissioned Substation', $2, NULL, 'electrical', true,
            '{"sourceKind":"manual","note":"F4.10 fixture: readings entered by hand, no gateway"}'::jsonb, $3)
    ON CONFLICT (code) DO UPDATE
       SET rtu_id = NULL,
           location_id = EXCLUDED.location_id,
           meta = EXCLUDED.meta,
           organization_id = EXCLUDED.organization_id
    RETURNING id
    `,
    [MANUAL_ASSET_CODE, locationId, organizationId],
  );
  const assetId = asset.rows[0]?.id;
  if (!assetId) {
    return;
  }

  // One point, so the asset is not merely gateway-less but demonstrably
  // *readable* without a gateway. ADR 0018's CHECK requires a `manual` point to
  // carry no rtu_id, which is exactly the pairing this proves.
  // The stock check FIRST, because it is the more informative of the two and it
  // needs no database. A code that has left the arrays fails both guards, and
  // the catalog one would report only "not in bms.point_keys", which sends a
  // reader looking at the database rather than at the list that moved.
  if (!STOCK_POINT_KEY_CODES.includes(MANUAL_POINT_KEY)) {
    throw new Error(
      `seedAccessControlFixtures: ${MANUAL_POINT_KEY} is not in STOCK_POINT_KEY_CODES. ` +
        "The fixture would bind a code the catalog seed does not own — one an " +
        "integration suite registered and is about to delete, most likely.",
    );
  }

  const pointKey = await pool.query<{ code: string; unit: string | null }>(
    `SELECT code, unit FROM bms.point_keys WHERE code = $1 AND active = true`,
    [MANUAL_POINT_KEY],
  );
  const key = pointKey.rows[0];
  // Loud, where the positional read simply returned whatever it found. A named
  // code that is absent means the stock catalog no longer holds it, and this
  // fixture silently not existing is the failure mode the whole file was
  // written to close — `scopeFromSource`'s `active = true` filter and ADR 0018's
  // nullable `rtu_id` were both empirically unprovable until it ran.
  if (!key) {
    throw new Error(
      `seedAccessControlFixtures: ${MANUAL_POINT_KEY} is not an active row in ` +
        "bms.point_keys, so the hand-read meter fixture has no point. Either " +
        "seedPointKeyCatalog did not run before this, or the code left the stock " +
        `vocabulary — in which case pick another from STOCK_POINT_KEY_CODES that no ` +
        "electrical asset's simulator writes, and update MANUAL_POINT_KEY.",
    );
  }
  await pool.query(
    `
    INSERT INTO bms.asset_points (asset_id, point_key, source_data_key, rtu_id, source_kind, unit, active, organization_id)
    VALUES ($1, $2, $3, NULL, 'manual', $4, true, $5)
    ON CONFLICT (asset_id, point_key) DO UPDATE
       SET rtu_id = NULL, source_kind = 'manual', organization_id = EXCLUDED.organization_id
    `,
    [assetId, key.code, `MANUAL_${key.code.toUpperCase()}`, key.unit, organizationId],
  );

}
