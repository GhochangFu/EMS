import pg from "pg";

/** Verifies org → location → RTU → asset → point_key counts after seed. */
export async function verifyHierarchySeed(pool: pg.Pool): Promise<void> {
  const checks = await pool.query<{
    orgs: string;
    eskom_locs: string;
    phe_locs: string;
    phe_rtus: string;
    phe_assets: string;
    phe_points: string;
    orphan_assets: string;
    loc_mismatch: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM bms.organizations) AS orgs,
      (SELECT COUNT(*)::text FROM bms.locations l
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'ESKOM') AS eskom_locs,
      (SELECT COUNT(*)::text FROM bms.locations l
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'PHEWB') AS phe_locs,
      (SELECT COUNT(*)::text FROM bms.rtus r
        INNER JOIN bms.locations l ON l.id = r.location_id
        INNER JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'PHEWB') AS phe_rtus,
      (SELECT COUNT(*)::text FROM bms.assets WHERE code LIKE 'PHE-%') AS phe_assets,
      (SELECT COUNT(*)::text FROM bms.asset_points ap
        INNER JOIN bms.assets a ON a.id = ap.asset_id
        WHERE a.code LIKE 'PHE-%') AS phe_points,
      -- ADR 0018: a null rtu_id is legal — an asset need not be wired. The
      -- axis that must never be null is the spatial one, because every scoped
      -- authorization check filters on it. Asserting the old invariant here
      -- would turn db:seed red on the first gateway-less asset from F1.8/F1.9.
      (SELECT COUNT(*)::text FROM bms.assets WHERE location_id IS NULL) AS orphan_assets,
      (SELECT COUNT(*)::text FROM bms.assets a
        INNER JOIN bms.rtus r ON r.id = a.rtu_id
        WHERE a.location_id IS DISTINCT FROM r.location_id) AS loc_mismatch
  `);

  const row = checks.rows[0];
  if (!row) {
    throw new Error("verifyHierarchySeed: no results");
  }

  const errors: string[] = [];
  if (Number(row.orgs) !== 2) {
    errors.push(`organizations: expected 2, got ${row.orgs}`);
  }
  // 11 = 10 operational + the deliberately inactive ESK-DECOMM-01 that F4.10
  // needs in order to tell `WHERE active = true` apart from no predicate.
  if (Number(row.eskom_locs) !== 11) {
    errors.push(`ESKOM locations: expected 11, got ${row.eskom_locs}`);
  }
  if (Number(row.phe_locs) !== 6) {
    errors.push(`PHEWB locations: expected 6, got ${row.phe_locs}`);
  }
  if (Number(row.phe_rtus) !== 12) {
    errors.push(`PHEWB RTUs: expected 12, got ${row.phe_rtus}`);
  }
  if (Number(row.phe_assets) !== 48) {
    errors.push(`PHE assets: expected 48, got ${row.phe_assets}`);
  }
  // 252, not 264: the catalog's 12 `TS` sensors are the MQTT envelope's own
  // timestamp, which the ingest adapter consumes as the sample time and can
  // never deliver as a reading. `phe-pilot-seed.ts` stopped cataloguing them on
  // 2026-08-06 rather than keep 12 rows claiming a provenance that is false by
  // construction. One per PHE device that carries the sensor.
  if (Number(row.phe_points) !== 252) {
    errors.push(`PHE asset_points: expected 252, got ${row.phe_points}`);
  }
  if (Number(row.orphan_assets) !== 0) {
    errors.push(`assets without location_id: ${row.orphan_assets}`);
  }
  if (Number(row.loc_mismatch) !== 0) {
    errors.push(`asset/RTU location mismatch: ${row.loc_mismatch}`);
  }

  if (errors.length > 0) {
    throw new Error(`Hierarchy seed verification failed:\n- ${errors.join("\n- ")}`);
  }
}
