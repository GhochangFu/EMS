import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import pg from "pg";

import { mapLocationRowsForInsert } from "./map-locations-seed";
import {
  assignEskomAssetRtus,
  ensureEskomDomainRtus,
  ensureOrganizations,
  enforceHierarchyNotNull,
  getOrganizationId,
  cleanupLegacyPheRtuLocations,
} from "./hierarchy-seed";
import { seedAccessControlFixtures } from "./access-fixtures-seed";
import { seedPointKeyCatalog } from "./point-keys-seed";
import { pheMapLocationRowsForInsert } from "./phe-map-seed";
import { seedPheCatalog } from "./phe-pilot-seed";
import { createDb } from "./client";
import { backfillAssetLocations, seedAssetGroups } from "./asset-groups-seed";
import { seedAutomationRules } from "./automation-rules-seed";
import {
  seedDemoAlarms,
  seedDemoWorkOrders,
  seedMaintenancePlans,
} from "./demo-operations-seed";
import {
  ensureAdminUser,
  seedPheOrganizationAdmin,
  seedScopedDemoUsers,
} from "./demo-users-seed";
import {
  buildEskomAssetCatalog,
  demoAssetsForRsmoc,
  seedEskomAssets,
} from "./eskom-assets-seed";
import {
  renameLegacyCapeTownMapLocation,
  seedEskomLocations,
  seedMapLocations,
} from "./eskom-locations-seed";

/**
 * The single `pnpm db:seed` entrypoint. It owns the pool and the call order and
 * nothing else — every block of rows lives in a sibling `*-seed.ts` module, so
 * this file stays under the AGENTS.md §4.5 1000-line cap as the demo data
 * grows. The order below is load-bearing and matches what CI has always run:
 * organizations → locations → RTUs → assets → operational demo rows → group
 * derivation → scoped users → the PHE pilot → the access-control fixtures →
 * the NOT NULL enforcement the verifier then checks.
 */

const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for seed");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = createDb(pool);
  const controlRoomSiteName = "RSMOC Western Cape";
  const mapLocationRows = [
    ...mapLocationRowsForInsert(),
    ...pheMapLocationRowsForInsert(),
  ];
  const rsmocDemoAssets = mapLocationRows.flatMap((row) =>
    row.kind === "rsmoc" && row.siteName && row.province
      ? demoAssetsForRsmoc(row.siteName, row.province)
      : [],
  );

  try {
    const adminId = await ensureAdminUser(db);

    await ensureOrganizations(pool);
    const eskomOrgId = await getOrganizationId(pool, "ESKOM");

    await seedMapLocations(db, mapLocationRows);
    await seedEskomLocations(db, mapLocationRows, eskomOrgId);
    await ensureEskomDomainRtus(db, pool);

    const assetRows = await seedEskomAssets(
      db,
      pool,
      buildEskomAssetCatalog(controlRoomSiteName, rsmocDemoAssets),
    );

    await seedDemoAlarms(db, assetRows, adminId);
    await seedDemoWorkOrders(db, assetRows, adminId);
    await seedMaintenancePlans(db, assetRows);
    await seedAutomationRules(db, assetRows);
    await renameLegacyCapeTownMapLocation(db, mapLocationRows);

    await backfillAssetLocations(pool);
    await assignEskomAssetRtus(pool);
    await seedAssetGroups(pool);

    await seedScopedDemoUsers(db);

    await seedPheCatalog(db, pool);
    await cleanupLegacyPheRtuLocations(pool);
    await seedPointKeyCatalog(pool);
    await seedPheOrganizationAdmin(db, pool);

    await seedAccessControlFixtures(pool);
    await enforceHierarchyNotNull(pool);
    const { verifyHierarchySeed } = await import("./verify-hierarchy-seed.js");
    await verifyHierarchySeed(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
