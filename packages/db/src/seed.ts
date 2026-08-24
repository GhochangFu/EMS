import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import { createSeedPool, withOrganization } from "./seed-tenant";
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
import { seedAutomationRules, seedEskomLadderRules } from "./automation-rules-seed";
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
 *
 * **`E7.1a` / ADR 0045 decision 5 added a second axis to that order: the
 * tenant.** The seed used to run as `bms_app`, a superuser, so row-level
 * security never applied to it. It now runs as `bms_owner`, which `FORCE ROW
 * LEVEL SECURITY` binds — and with no `app.current_organization` set, the five
 * tables migration `0040` protects return **zero** rows and reject every
 * insert. So the call order below is grouped into phases, and each phase that
 * touches one of those tables runs inside `withOrganization`.
 *
 * Three kinds of phase, and the distinction is worth keeping when this file
 * changes:
 *
 *  - **Pre-tenant.** `bms.users`, `bms.organizations` and `bms.map_locations`
 *    carry no policy, and the organization ids have to be read before any
 *    tenant context can be set.
 *  - **Per-organization.** Everything scoped to ESKOM or to PHEWB.
 *  - **Cross-organization derivation.** Statements that joined `bms.locations`
 *    across both organizations in one pass. They now run once per organization;
 *    the union of the two passes is what the single unfiltered statement used
 *    to compute.
 */

const pkgRoot = process.cwd();

loadEnv({ path: resolve(pkgRoot, "../../apps/api/.env") });
loadEnv({ path: resolve(pkgRoot, ".env") });

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for seed");
  }

  // `max: 1` is load-bearing — see `seed-tenant.ts`. The sibling modules query
  // this pool directly rather than checking out a client, so they only join
  // `withOrganization`'s transaction while the pool can hand out no other
  // connection.
  const pool = createSeedPool(databaseUrl);
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
    // ── Pre-tenant ────────────────────────────────────────────────────────
    // No policy applies to any of these, and the organization ids must be read
    // before a tenant context can name one.
    const adminId = await ensureAdminUser(db);

    await ensureOrganizations(pool);
    const eskomOrgId = await getOrganizationId(pool, "ESKOM");
    const phewbOrgId = await getOrganizationId(pool, "PHEWB");

    await seedMapLocations(db, mapLocationRows);

    // ── ESKOM ─────────────────────────────────────────────────────────────
    await withOrganization(pool, eskomOrgId, async () => {
      await seedEskomLocations(db, mapLocationRows, eskomOrgId);
      await ensureEskomDomainRtus(db, pool);

      const eskomCatalog = buildEskomAssetCatalog(controlRoomSiteName, rsmocDemoAssets);
      const assetRows = await seedEskomAssets(db, pool, eskomCatalog);

      await seedDemoAlarms(db, assetRows, adminId);
      await seedDemoWorkOrders(db, assetRows, adminId);
      await seedMaintenancePlans(db, assetRows);
      await seedAutomationRules(db, assetRows);
      await renameLegacyCapeTownMapLocation(db, mapLocationRows);
    });

    // ── Cross-organization derivation ─────────────────────────────────────
    // Both statements join `bms.locations`, which is now policy-filtered, so
    // one pass per organization replaces the single unfiltered pass. On a fresh
    // database PHEWB has no locations yet and its pass matches nothing; on a
    // re-seed it matches the rows the old single statement would have.
    for (const organizationId of [eskomOrgId, phewbOrgId]) {
      await withOrganization(pool, organizationId, async () => {
        await backfillAssetLocations(pool);
        await assignEskomAssetRtus(pool);
      });
    }
    // Reads `bms.assets` and writes `bms.asset_groups`/`asset_group_members`,
    // none of which carry a policy. It needs no tenant context, and giving it
    // one would imply a scoping it does not have.
    await seedAssetGroups(pool);

    await withOrganization(pool, eskomOrgId, async () => {
      await seedScopedDemoUsers(db);
    });

    // ── PHEWB ─────────────────────────────────────────────────────────────
    await withOrganization(pool, phewbOrgId, async () => {
      await seedPheCatalog(db, pool);
      await cleanupLegacyPheRtuLocations(pool);
      await seedPheOrganizationAdmin(db, pool);
    });

    // Writes `bms.point_keys` for both organizations, so it sets its own tenant
    // context around each catalog rather than taking one from here.
    await seedPointKeyCatalog(pool);

    // ── ESKOM, after the point-key catalog it depends on ───────────────────
    await withOrganization(pool, eskomOrgId, async () => {
      await seedAccessControlFixtures(pool);
      // After access fixtures, not inside seedAutomationRules: this needs every
      // ESKOM electrical asset to exist, including ESK-MANUAL-01, which the
      // call just above this one creates.
      await seedEskomLadderRules(db);
    });

    // ── Post-tenant ───────────────────────────────────────────────────────
    await enforceHierarchyNotNull(pool);
    const { verifyHierarchySeed } = await import("./verify-hierarchy-seed.js");
    await verifyHierarchySeed(pool, { eskomOrgId, phewbOrgId });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
