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
    INNER JOIN bms.locations l ON l.id = a.location_id
    INNER JOIN bms.organizations o ON o.id = l.organization_id
    WHERE o.code = 'ESKOM'
      AND a.code NOT LIKE 'PHE-%'
      -- ADR 0018 made a gateway-less asset legal, and F4.10 seeds one to prove
      -- the scope queries do not join through bms.rtus. Without this exemption
      -- the second db:seed would wire it and the fixture would silently stop
      -- being a fixture. Any hand-read asset is exempt, not just that one.
      AND COALESCE(a.meta->>'sourceKind', '') <> 'manual'
  `);

  for (const row of rows.rows) {
    const rtuId = await resolveEskomSimRtuId(pool, row.site_name, row.domain).catch(
      () => null,
    );
    if (!rtuId) {
      continue;
    }
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

/**
 * Sets NOT NULL on hierarchy FK columns after seed backfill.
 *
 * ADR 0018 inverted the asset polarities: `location_id` is now mandatory and
 * `rtu_id` is not. This function used to run
 * `ALTER TABLE bms.assets ALTER COLUMN rtu_id SET NOT NULL`, which would have
 * silently re-applied the old constraint on every `db:seed` and undone
 * migration 0023 — including in CI, which runs `db:migrate` then `db:seed`.
 * A migration is not the last word on schema here; this is. Do not re-add it.
 */
export async function enforceHierarchyNotNull(pool: pg.Pool): Promise<void> {
  const assetOrphans = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM bms.assets WHERE location_id IS NULL
  `);
  if (Number(assetOrphans.rows[0]?.n ?? "0") > 0) {
    throw new Error("Cannot enforce NOT NULL: assets without location_id remain");
  }
  // `E7.1a`: this pre-check is now **vacuous, and deliberately kept.** Since
  // ADR 0045 the seed runs as `bms_owner` under `FORCE ROW LEVEL SECURITY`, and
  // a row with `organization_id IS NULL` matches no tenant policy under any
  // `app.current_organization` — so this count reads 0 whether or not an orphan
  // exists, and no tenant context can rescue it.
  //
  // What is lost is the friendly message, not the guarantee: RLS filters DML,
  // it does not filter constraint validation, so the `SET NOT NULL` below still
  // scans every row and still fails loudly on a real orphan. Do not "fix" this
  // by widening the role or by deleting the check — the first defeats the
  // point of the item and the second removes the place this note lives.
  const locOrphans = await pool.query<{ n: string }>(`
    SELECT COUNT(*)::text AS n FROM bms.locations WHERE organization_id IS NULL
  `);
  if (Number(locOrphans.rows[0]?.n ?? "0") > 0) {
    throw new Error("Cannot enforce NOT NULL: locations without organization_id remain");
  }
  await pool.query(`
    ALTER TABLE bms.assets ALTER COLUMN location_id SET NOT NULL
  `);
  await pool.query(`
    ALTER TABLE bms.locations ALTER COLUMN organization_id SET NOT NULL
  `);
  // Assert the gateway column is nullable, rather than merely not asserting the
  // opposite. Removing the old `SET NOT NULL` stops this seed re-applying it,
  // but does not undo a constraint an earlier build already applied — and
  // drizzle will not re-run migration 0023 to repair it, because it is recorded
  // as applied. Any database that ran an older seed after migrating is stuck
  // otherwise. Found by creating a gateway-less asset through the UI against a
  // stack whose `migrate` service image predated this change.
  await pool.query(`
    ALTER TABLE bms.assets ALTER COLUMN rtu_id DROP NOT NULL
  `);
}

/**
 * Removes legacy PHE locations that used one RTU per location slug.
 *
 * **Must run inside a PHEWB tenant context** (`seed.ts` supplies one). All five
 * statements below join or target `bms.locations`, which carries `FORCE ROW
 * LEVEL SECURITY` since `E7.1a`. Without a context the role sees no location
 * rows, so every `DELETE` matches nothing, deletes nothing, and reports success
 * — the legacy rows would survive with no error anywhere. This is the one place
 * in the seed where a missing tenant context fails silently rather than loudly.
 */
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
