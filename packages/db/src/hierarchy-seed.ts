import { eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { locations } from "./schema/bms-schema";

const DOMAIN_RTU_SUFFIX: Record<string, string> = {
  electrical: "ELEC",
  hvac: "HVAC",
  it: "IT",
  environment: "ENV",
};

/** Maps asset domain to simulator RTU domain column. */
export function rtuDomainForAssetDomain(domain: string): string {
  if (domain === "it") {
    return "it";
  }
  return domain;
}

/** Returns organization id by code (ESKOM | PHEWB). */
export async function getOrganizationId(
  pool: pg.Pool,
  code: string,
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM bms.organizations WHERE code = $1 LIMIT 1`,
    [code],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error(`Organization not found: ${code}`);
  }
  return id;
}

/** Ensures ESKOM and PHEWB organization rows exist. */
export async function ensureOrganizations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    INSERT INTO bms.organizations (code, name, meta)
    VALUES
      ('ESKOM', 'Eskom SMOC', '{"tenant":"demo"}'::jsonb),
      ('PHEWB', 'Public Health Engineering — West Bengal', '{"orgId":10}'::jsonb)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  `);
}

/** Creates simulator RTUs per domain for each Eskom canonical location. */
export async function ensureEskomDomainRtus(db: BmsDb, pool: pg.Pool): Promise<void> {
  const eskomOrgId = await getOrganizationId(pool, "ESKOM");
  const locRows = await db
    .select({
      id: locations.id,
      code: locations.code,
      name: locations.name,
    })
    .from(locations)
    .where(eq(locations.organizationId, eskomOrgId));

  for (const loc of locRows) {
    for (const [domain, suffix] of Object.entries(DOMAIN_RTU_SUFFIX)) {
      const code = `SIM-RTU-${loc.code}-${suffix}`;
      const displayName = `${loc.name} ${domain.toUpperCase()} Simulator`;
      await pool.query(
        `
        INSERT INTO bms.rtus (
          location_id, code, display_name, source_type, domain, ingest_enabled, meta
        )
        VALUES ($1, $2, $3, 'simulator', $4, false, '{"synthetic":true}'::jsonb)
        ON CONFLICT (location_id, code) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          source_type = EXCLUDED.source_type,
          domain = EXCLUDED.domain
        `,
        [loc.id, code, displayName, domain],
      );
    }
  }
}

/** Resolves simulator RTU id for an Eskom asset by site name and domain. */
export async function resolveEskomSimRtuId(
  pool: pg.Pool,
  siteName: string,
  assetDomain: string,
): Promise<string> {
  const domain = rtuDomainForAssetDomain(assetDomain);
  const suffix = DOMAIN_RTU_SUFFIX[domain];
  if (!suffix) {
    throw new Error(`Unknown asset domain for RTU mapping: ${assetDomain}`);
  }
  const res = await pool.query<{ id: string }>(
    `
    SELECT r.id
    FROM bms.rtus r
    INNER JOIN bms.locations l ON l.id = r.location_id
    INNER JOIN bms.organizations o ON o.id = l.organization_id
    WHERE l.name = $1
      AND o.code = 'ESKOM'
      AND r.domain = $2
      AND r.source_type = 'simulator'
    LIMIT 1
    `,
    [siteName, domain],
  );
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error(`No simulator RTU for site=${siteName} domain=${domain}`);
  }
  return id;
}

/** Assigns rtu_id on Eskom assets that are missing it. */
export async function assignEskomAssetRtus(pool: pg.Pool): Promise<void> {
  const rows = await pool.query<{
    id: string;
    site_name: string;
    domain: string;
    location_id: string | null;
  }>(`
    SELECT a.id, a.site_name, a.domain, a.location_id
    FROM bms.assets a
    LEFT JOIN bms.organizations o ON o.id = (
      SELECT l.organization_id FROM bms.locations l WHERE l.id = a.location_id
    )
    WHERE a.code NOT LIKE 'PHE-%'
      AND (a.rtu_id IS NULL OR a.rtu_id IS NOT NULL)
  `);

  for (const row of rows.rows) {
    const rtuId = await resolveEskomSimRtuId(pool, row.site_name, row.domain);
    await pool.query(
      `
      UPDATE bms.assets
      SET rtu_id = $1,
          meta = COALESCE(meta, '{}'::jsonb) || '{"telemetrySource":"simulator"}'::jsonb
      WHERE id = $2
      `,
      [rtuId, row.id],
    );
  }
}

/** Sets NOT NULL on hierarchy FK columns after seed backfill. */
export async function enforceHierarchyNotNull(pool: pg.Pool): Promise<void> {
  const orphans = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM bms.assets WHERE rtu_id IS NULL
  `);
  if (Number(orphans.rows[0]?.n ?? "0") > 0) {
    throw new Error("Cannot enforce NOT NULL: assets without rtu_id remain");
  }
  const locOrphans = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM bms.locations WHERE organization_id IS NULL
  `);
  if (Number(locOrphans.rows[0]?.n ?? "0") > 0) {
    throw new Error("Cannot enforce NOT NULL: locations without organization_id remain");
  }
  await pool.query(`
    ALTER TABLE bms.assets ALTER COLUMN rtu_id SET NOT NULL
  `);
  await pool.query(`
    ALTER TABLE bms.locations ALTER COLUMN organization_id SET NOT NULL
  `);
}

/** Removes legacy PHE locations that used one RTU per location slug. */
export async function cleanupLegacyPheRtuLocations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DELETE FROM bms.user_location_access ula
    USING bms.locations l
    WHERE ula.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.asset_group_members agm
    USING bms.asset_groups ag, bms.locations l
    WHERE agm.asset_group_id = ag.id
      AND ag.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.asset_groups ag
    USING bms.locations l
    WHERE ag.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.rtus r
    USING bms.locations l
    WHERE r.location_id = l.id
      AND l.slug ~ '^phe-.+-(i|ii)$'
  `);
  await pool.query(`
    DELETE FROM bms.locations
    WHERE slug ~ '^phe-.+-(i|ii)$'
  `);
}
