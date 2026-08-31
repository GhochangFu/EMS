import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import pg from "pg";

import { createSeedPool, resolveSeedSuperuserUrl, withOrganization } from "./seed-tenant";
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
import { seedRuledPointCatalog } from "./ruled-point-catalog-seed";
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
 * Four kinds of phase, and the distinction is worth keeping when this file
 * changes:
 *
 *  - **Pre-tenant.** `bms.organizations` and `bms.map_locations` carry no
 *    policy, and the organization ids have to be read before any tenant context
 *    can be set.
 *  - **Identity.** The org-less `bms.users` rows and their access grants
 *    (`ensureAdminUser`, `seedScopedDemoUsers`, `seedPheOrganizationAdmin`). Run
 *    on a **superuser connection**, not `pool`: since `E7.1b`'s `0047`,
 *    `bms.users` is `FORCE`-bound with a strict `USING`, so `bms_owner` can
 *    neither see nor `RETURNING`-insert an org-less user, and the pool roles
 *    hold no `INSERT` on it. See `resolveSeedSuperuserUrl` in `seed-tenant.ts`.
 *  - **Per-organization.** Everything scoped to ESKOM or to PHEWB, stamping
 *    `organization_id` and running inside that org's `withOrganization`.
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

  // The identity connection (`bms_app` superuser). Only the three org-less
  // `bms.users` seeders use it, and they run outside any `withOrganization`
  // transaction, so it needs no `max: 1` and does not join the tenant dance.
  const superuserPool = new pg.Pool({
    connectionString: resolveSeedSuperuserUrl(databaseUrl, process.env),
  });
  const identityDb = createDb(superuserPool);
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
    //
    // `ensureAdminUser` runs on `identityDb` (superuser): the global admin is
    // org-less, and since `0047` a `FORCE`-bound `bms_owner` can neither see it
    // on a re-seed nor `INSERT ... RETURNING` it on a fresh one.
    const adminId = await ensureAdminUser(identityDb);

    await ensureOrganizations(pool);
    const eskomOrgId = await getOrganizationId(pool, "ESKOM");
    const phewbOrgId = await getOrganizationId(pool, "PHEWB");

    await seedMapLocations(db, mapLocationRows);

    // ── ESKOM ─────────────────────────────────────────────────────────────
    await withOrganization(pool, eskomOrgId, async () => {
      await seedEskomLocations(db, mapLocationRows, eskomOrgId);
      await ensureEskomDomainRtus(db, pool);

      const eskomCatalog = buildEskomAssetCatalog(controlRoomSiteName, rsmocDemoAssets);
      const assetRows = await seedEskomAssets(db, pool, eskomCatalog, eskomOrgId);

      await seedDemoAlarms(db, assetRows, adminId, eskomOrgId);
      await seedDemoWorkOrders(db, assetRows, adminId, eskomOrgId);
      await seedMaintenancePlans(db, assetRows, eskomOrgId);
      await seedAutomationRules(db, assetRows, eskomOrgId);
      await renameLegacyCapeTownMapLocation(db, mapLocationRows);
    });

    // ── Cross-organization derivation ─────────────────────────────────────
    // Every statement joins or writes `bms.locations`/`assets`/`asset_groups`,
    // all of which `0047` now policy-filters, so one pass per organization
    // replaces the single unfiltered pass. On a fresh database PHEWB has no
    // locations yet and its pass matches nothing; on a re-seed it matches the
    // rows the old single statement would have. `seedAssetGroups` moved inside
    // this loop for the same reason — `asset_groups` gained a NOT-NULL org and a
    // policy, so the group/member writes need the org's context and its stamp.
    for (const organizationId of [eskomOrgId, phewbOrgId]) {
      await withOrganization(pool, organizationId, async () => {
        await backfillAssetLocations(pool);
        await assignEskomAssetRtus(pool);
        await seedAssetGroups(pool, organizationId);
      });
    }

    // Identity: org-less users + grants on `identityDb`, after the groups the
    // scope grant references exist. Not wrapped in `withOrganization` — the rows
    // are org-less and the superuser bypasses the policy `0047` put on `users`.
    await seedScopedDemoUsers(identityDb, eskomOrgId);

    // ── PHEWB ─────────────────────────────────────────────────────────────
    await withOrganization(pool, phewbOrgId, async () => {
      await seedPheCatalog(db, pool);
      await cleanupLegacyPheRtuLocations(pool);
    });
    // The PHEWB organization admin is another org-less identity row: superuser,
    // outside the tenant context. `pool` is passed only for its `organizations`
    // lookup (unpoliced); the `users`/`user_organization_access` writes are on
    // `identityDb`.
    await seedPheOrganizationAdmin(identityDb, pool);

    // Writes `bms.point_keys` for both organizations, so it sets its own tenant
    // context around each catalog rather than taking one from here.
    await seedPointKeyCatalog(pool);

    // ── ESKOM, after the point-key catalog it depends on ───────────────────
    await withOrganization(pool, eskomOrgId, async () => {
      await seedAccessControlFixtures(pool);
      // After access fixtures, not inside seedAutomationRules: this needs every
      // ESKOM electrical asset to exist, including ESK-MANUAL-01, which the
      // call just above this one creates.
      await seedEskomLadderRules(db, eskomOrgId);
      // `F4.69` — last inside this bracket, because it derives from the rules
      // every call above it writes. A catalog row for each published threshold
      // rule's point is what makes a tag scoreable (`E1.3`) and pickable
      // (`F3.35`); before it, `bms.asset_points` held no row for any ESKOM asset.
      await seedRuledPointCatalog(pool, eskomOrgId);
    });

    // ── Post-tenant ───────────────────────────────────────────────────────
    await enforceHierarchyNotNull(pool);
    const { verifyHierarchySeed } = await import("./verify-hierarchy-seed.js");
    await verifyHierarchySeed(pool, { eskomOrgId, phewbOrgId });
  } finally {
    await pool.end();
    await superuserPool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
