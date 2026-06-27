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
      (SELECT COUNT(*)::text FROM bms.assets WHERE rtu_id IS NULL) AS orphan_assets,
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
  if (Number(row.eskom_locs) !== 10) {
    errors.push(`ESKOM locations: expected 10, got ${row.eskom_locs}`);
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
  if (Number(row.phe_points) !== 264) {
    errors.push(`PHE asset_points: expected 264, got ${row.phe_points}`);
  }
  if (Number(row.orphan_assets) !== 0) {
    errors.push(`assets without rtu_id: ${row.orphan_assets}`);
  }
  if (Number(row.loc_mismatch) !== 0) {
    errors.push(`asset/RTU location mismatch: ${row.loc_mismatch}`);
  }

  if (errors.length > 0) {
    throw new Error(`Hierarchy seed verification failed:\n- ${errors.join("\n- ")}`);
  }
}
