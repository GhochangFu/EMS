import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

import pg from "pg";

import { createSeedPool, resolveSeedSuperuserUrl, withOrganization } from "./seed-tenant";
import {
  assignEskomAssetRtus,
  ensureEskomDomainRtus,
  ensureOrganizations,
  enforceHierarchyNotNull,
  getOrganizationId,
  cleanupLegacyPheRtuLocations,
} from "./hierarchy-seed";
import { seedAccessControlFixtures, seedDecommissionedLocation } from "./access-fixtures-seed";
import { seedAssetDomains } from "./asset-domains-seed";
import { seedPointKeyCatalog } from "./point-keys-seed";
import { seedPointKeyHeadlineRanks } from "./point-key-headline-ranks-seed";
import { seedPointKeyStates } from "./point-key-states-seed";
import { loadPheCatalog, phePilotExpectedRows, seedPheCatalog } from "./phe-pilot-seed";
import { createDb } from "./client";
import { backfillAssetLocations, seedAssetGroups } from "./asset-groups-seed";
import {
  type LadderCollisionSkip,
  seedAutomationRules,
  seedEskomLadderRules,
} from "./automation-rules-seed";
import { seedRuledPointCatalog } from "./ruled-point-catalog-seed";
import { seedAssetTemplateHealth } from "./asset-template-health-seed";
import { seedBreakerDemo } from "./breaker-demo-seed";
import { seedPueDemo, seedPueDemoRackKwPoints } from "./pue-demo-seed";
import { seedWaterMimicDemo } from "./water-mimic-demo-seed";
import { seedWaterPlantDemo } from "./water-plant-demo-seed";
import { seedCalcParametersDemo } from "./calc-parameters-demo-seed";
import { seedCopilotDemo } from "./copilot-demo-seed";
import {
  seedDemoAlarms,
  seedDemoWorkOrders,
  seedMaintenancePlans,
} from "./demo-operations-seed";
import {
  ensureAdminUser,
  seedPheOrganizationAdmin,
  seedScopedDemoUsers,
  WC_ADMIN_LOCATION_KEY,
} from "./demo-users-seed";
import { eskomSeedAssetCatalog, seedEskomAssets } from "./eskom-assets-seed";
import {
  locationIdsWithoutSeedCode,
  renameLegacyCapeTownMapLocation,
  seedEskomLocations,
  seedMapLocationRows,
  seedMapLocations,
} from "./eskom-locations-seed";
import { seedSiteControlRoomViews } from "./site-control-room-views-seed";
import { seedEskomSiteLayouts, seedPhewbSiteLayouts } from "./site-layout-seed";

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

  // The identity connection (`bms_app` superuser). The three org-less
  // `bms.users` seeders use it, outside any `withOrganization` transaction,
  // and `seedEskomLocations` reads slug holders on it (owner ruling 16) —
  // reads only, which never join the tenant transaction, so it needs no
  // `max: 1`. `seedDecommissionedLocation` reads its slug holder there too.
  const superuserPool = new pg.Pool({
    connectionString: resolveSeedSuperuserUrl(databaseUrl, process.env),
  });
  const identityDb = createDb(superuserPool);
  // The PHE catalog is read once here, for the map rows and the legacy slugs.
  const pheCatalog = loadPheCatalog();
  // The same list `hierarchyExpectations` derives the boot gate's ESKOM
  // location codes and asset catalog from.
  const mapLocationRows = seedMapLocationRows(pheCatalog);
  // Owner ruling 13: the legacy PHE cleanup deletes these twelve slugs and no
  // other row, whatever slug an administrator gives a PHEWB location.
  const legacyPheLocationSlugs = phePilotExpectedRows(pheCatalog).legacyLocationSlugs;
  // Written by `seedEskomLadderRules` in the second ESKOM bracket, read by the
  // verifier after every bracket has closed.
  let ladderCollisionSkips: LadderCollisionSkip[] = [];
  // The row seedEskomLocations resolved for RSMOC-WC, for the scoped demo
  // users' grants after the groups exist (owner ruling 17); null when none.
  let westernCapeId: string | null = null;

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
      // Owner ruling 16 (OQ2): the slug-holder pre-read runs on the superuser
      // pool, so a location of any organization holding a canonical slug is
      // seen and skipped with a log line rather than met as 23505.
      const seedLocations = await seedEskomLocations(pool, superuserPool, mapLocationRows, eskomOrgId);
      westernCapeId = seedLocations.get(WC_ADMIN_LOCATION_KEY)?.id ?? null;
      // F4.10's inactive location, before the RTU step (addendum 3): restored
      // later, a code PATCH on it left a second RTU set under the admin code.
      const decommissionedLocation = await seedDecommissionedLocation(pool, superuserPool, eskomOrgId);
      // F3.67 (ADR 0076 decision 6, OQ2), owner ruling 17: the view goes on
      // the row seedEskomLocations resolved for RSMOC-WC, never one found by code.
      await seedSiteControlRoomViews(db, eskomOrgId, seedLocations);
      // Owner ruling 17: a seed row whose canonical code another row holds
      // gets no RTU under the admin's code.
      await ensureEskomDomainRtus(
        db,
        pool,
        locationIdsWithoutSeedCode([...seedLocations.values(), decommissionedLocation]),
      );

      const eskomCatalog = eskomSeedAssetCatalog(mapLocationRows);
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
    // replaces the single unfiltered pass. `seedAssetGroups` moved inside that
    // per-organization bracket for the same reason — `asset_groups` gained a
    // NOT-NULL org and a policy, so the group/member writes need the org's
    // context and its stamp.
    //
    // **`F3.41` SPLIT THE LOOP, AND THE REASON IS THE SENTENCE IT REPLACES.**
    // This used to run `for (const organizationId of [eskomOrgId, phewbOrgId])`
    // HERE, above `seedPheCatalog`, and conceded the consequence in its own
    // words: *"On a fresh database PHEWB has no locations yet and its pass
    // matches nothing; on a re-seed it matches the rows the old single
    // statement would have."* That was tolerable while the pass only derived
    // `location_id`. It stopped being tolerable when `F3.41` made the pass the
    // thing that writes PHE WB's asset-group ROLES, because a role that exists
    // only after a second seed is a feature that works on a developer machine
    // and nowhere else — CI seeds exactly once against a fresh schema
    // (`.github/workflows/ci.yml`, "Validate seed against a fresh schema"), and
    // so does the PHE pilot.
    //
    // ESKOM's pass stays exactly where it was: `seedScopedDemoUsers` below
    // depends on ESKOM's groups already existing, and says so.
    await withOrganization(pool, eskomOrgId, async () => {
      await backfillAssetLocations(pool);
      await assignEskomAssetRtus(pool);
      await seedAssetGroups(pool, eskomOrgId);
    });

    // Identity: org-less users + grants on `identityDb`, after the groups the
    // scope grant references exist. Not wrapped in `withOrganization` — the rows
    // are org-less and the superuser bypasses the policy `0047` put on `users`.
    await seedScopedDemoUsers(identityDb, eskomOrgId, westernCapeId);

    // ── PHEWB ─────────────────────────────────────────────────────────────
    await withOrganization(pool, phewbOrgId, async () => {
      await seedPheCatalog(db, pool);
      await cleanupLegacyPheRtuLocations(pool, legacyPheLocationSlugs);
      // `F3.41` — PHEWB's derivation pass, AFTER the catalog that creates the
      // locations and assets it derives from. All three calls moved, not two:
      // dropping `assignEskomAssetRtus` from this pass is probably harmless and
      // is certainly a second change, and keeping it makes this a pure
      // relocation, so the only thing that changed is *when* the pass runs.
      //
      // `verifyHierarchySeed`'s two PHE membership counts are what hold this
      // order — put these back above `seedPheCatalog` and it fails with 0 of 36.
      // (The third, "no PHE environment member carries a role", moved to
      // `asset-groups-seed.spec.ts` under owner ruling 10: it held the ruling,
      // not the order.)
      await backfillAssetLocations(pool);
      // **`assignEskomAssetRtus` now runs AFTER the catalog that writes PHE's
      // own `rtu_id`, and cannot disturb it — but only because of a predicate
      // that is not visible from here.** `hierarchy-seed.ts` filters
      // `WHERE o.code = 'ESKOM' AND a.code NOT LIKE 'PHE-%'`, and `0047` scopes
      // `bms.locations` to PHEWB inside this bracket, so its driving SELECT
      // returns zero rows and the loop never runs an UPDATE. Two independent
      // reasons, either sufficient. Named by the `migration-reviewer` sweep,
      // because "a pure relocation" is only true given that predicate.
      await assignEskomAssetRtus(pool);
      await seedAssetGroups(pool, phewbOrgId);
    });
    // The PHEWB organization admin is another org-less identity row: superuser,
    // outside the tenant context. `pool` is passed only for its `organizations`
    // lookup (unpoliced); the `users`/`user_organization_access` writes are on
    // `identityDb`.
    await seedPheOrganizationAdmin(identityDb, pool);

    // `E5.2`: the pack's domain rows first (ADR 0031 A1.1, unpoliced, no
    // tenant context), then the point keys filed under them — the module says why.
    await seedAssetDomains(pool);

    // `F3.39`: one fleet-wide catalog, so no tenant context at all — neither
    // one taken from here nor one it opens itself. `bms.point_keys` lost its
    // policy, its FORCE flag and its `organization_id` in migration `0057`.
    await seedPointKeyCatalog(pool);

    // `F3.68` D8 (ADR 0076 decision 7) — after `seedPointKeyCatalog` AND after
    // `seedPheCatalog` above, on every path: both insert `bms.point_keys` rows
    // with `headline_rank` left NULL, and this call would rank a row that did
    // not exist yet if it ran any earlier. No tenant context, same as the
    // catalog it follows — `bms.point_keys` is fleet-wide and unpoliced since
    // `0057`/`0059`.
    await seedPointKeyHeadlineRanks(pool);

    // `F3.74` D1 — the breaker state map. After `seedPointKeyCatalog`: its rows reference
    // `breaker_main` and `breaker_trip`. Global vocabulary, no tenant context (no policy).
    await seedPointKeyStates(pool);

    // ── ESKOM, after the point-key catalog it depends on ───────────────────
    await withOrganization(pool, eskomOrgId, async () => {
      await seedAccessControlFixtures(pool);
      // After access fixtures, not inside seedAutomationRules: this needs every
      // ESKOM electrical asset to exist, including ESK-MANUAL-01, which the
      // call just above this one creates.
      ladderCollisionSkips = await seedEskomLadderRules(db, eskomOrgId);
      // `F4.69` — last inside this bracket, because it derives from the rules
      // every call above it writes. A catalog row for each published threshold
      // rule's point is what makes a tag scoreable (`E1.3`) and pickable
      // (`F3.35`); before it, `bms.asset_points` held no row for any ESKOM asset.
      await seedRuledPointCatalog(pool, eskomOrgId);
      // `F3.74` plan D11 — the breaker demo at RSMOC-WC: the forced breaker roles, the preset's
      // members, `breaker_trip`, the nameplates and `sld-demo-rsmoc-wc`. After `seedAssetGroups`
      // (the group) and `seedPointKeyCatalog` (the key), and before `seedAssetTemplateHealth`, so
      // `BASELINE-ELECTRICAL` declares `breaker_trip` on the first boot as on every later one.
      // (On a cold database only the unroled electrical assets stay on `BASELINE-ELECTRICAL`; roled ones move to their role template.)
      await seedBreakerDemo(pool, eskomOrgId, westernCapeId);
      // `F2.8`, first half — the fourteen `rack_kw` catalog rows, and NOTHING
      // ELSE. It sits here, between the ruled-point catalog and the health
      // baselines, and both sides of that are load-bearing. After the catalog,
      // because `rack_kw` is an FK into `bms.point_keys` that
      // `seedPointKeyCatalog` fills. **Before `seedAssetTemplateHealth`,
      // because `HEALTH_TEMPLATE_POINTS_SQL` declares on each `BASELINE-*`
      // every non-computed `bms.asset_points` key its domain's assets carry.**
      // Written after it — as this module's one call used to be — the rows are
      // invisible to that statement on a cold database, so `BASELINE-IT`
      // declares `pdu_util_pct` alone on the first boot and gains `rack_kw` on
      // the second, on a published and therefore immutable version (ADR 0015).
      // Run 1 would not equal run N, and only a cold start could show it.
      await seedPueDemoRackKwPoints(pool, eskomOrgId);
      // `E4.3` U11 — the demo water plant's mirror templates, flow catalog
      // rows, pins and balance roles. Both sides of this position are
      // load-bearing. After `seedPointKeyCatalog`, because every flow and
      // volume key is an FK into `bms.point_keys`. BEFORE
      // `seedAssetTemplateHealth`, because that module pins every
      // `template_id IS NULL` asset of a domain to its role template
      // (`F2.32`) or, failing one, to `BASELINE-<DOMAIN>`: run
      // after it on a cold database, the five water assets would be pinned
      // to a `BASELINE-WATER` that declares no point (the flow rows below do
      // not exist yet), and `seedAssetTemplateHealth` would throw
      // `unusable = 1` and stop the boot. `tests/e4.3-demo-water-plant.test.ts`
      // holds the order; `verifyHierarchySeed`'s four ESKOM water counts hold
      // the result.
      await seedWaterPlantDemo(pool, eskomOrgId);
      // `F3.32` v1 / ADR 0079 decision 5 — the mimic demo group and dashboard,
      // right after the water plant it reads: `seedWaterMimicDemo` looks up
      // the five `WTR-` assets and the site's location id (backfilled above,
      // in `seedAssetGroups`'s bracket), and this position is also before
      // `seedAssetTemplateHealth` and `seedPueDemo` below to keep this row's
      // additions grouped with the water-plant demo they extend.
      await seedWaterMimicDemo(pool, eskomOrgId);
      // `F4.75` — after the catalog, because the templates declare the points
      // the call above writes. This is what gives a scored asset a *band*: the
      // score was demonstrable from `F4.69` on, but `bms.asset_templates` held
      // no row, so every asset reported `band: null` and the donut drew nothing.
      await seedAssetTemplateHealth(pool, eskomOrgId);
      // `F2.8`, second half — LAST in this bracket: the incomer template, its
      // points and the pin, plus the post-condition that reads back both halves.
      // The position is load-bearing three ways: after `seedAssetGroups` above
      // (the `incoming-supply` role is the pin's selector, and `IT_LOAD` is the
      // group `it_kw` resolves through), after `seedPointKeyCatalog`
      // (`site_kw`, `it_kw` and `pue` are FKs into `bms.point_keys`), and after
      // `seedAssetTemplateHealth` (since `F2.32`, its
      // `BASELINE-ELECTRICAL-INCOMING_SUPPLY` role template is both the copy
      // source of the measured points and the pin the nine incomers move off).
      // Put this call above any of them and `verifyHierarchySeed`'s three ESKOM
      // PUE counts fail on a cold database with 0 of 9 / 0 of 14 / 0 of 14 —
      // and only on a cold one, which is why the cold-start gate exists.
      await seedPueDemo(pool, eskomOrgId);
      // `E4.1c` — the demo tariff row (ADR 0070 decision 7, Q1 ruling). ESKOM
      // only, insert-if-absent; the module header says why both. Inside this
      // bracket because `bms.calc_parameters` is FORCE-RLS and the row needs
      // the tenant GUC. Order-free within the seed: it references the organization
      // and the `energy_tariff_per_kwh` vocabulary row, which migration `0074`
      // writes — so `roles → migrate → seed` puts it there on every environment.
      await seedCalcParametersDemo(pool, eskomOrgId);
      // `F3.85` plan Q5 — the demo organization's copilot switch, on. ESKOM only,
      // insert-if-absent (the module header says why both); inside this bracket
      // because `bms.copilot_org_settings` is FORCE-RLS. Order-free: it references
      // only the organization.
      await seedCopilotDemo(pool, eskomOrgId);
      // `F3.73` plan D12 — LAST, so the order is one fact: the SMOC standard site layout copies
      // bind the groups, domains and roles both `seedAssetGroups` passes wrote, the second water
      // group `seedWaterMimicDemo` wrote, and the points every writer above wrote.
      await seedEskomSiteLayouts(pool, eskomOrgId, mapLocationRows);
    });

    // `F3.73` plan D12 — PHEWB's copies, in their own bracket after ESKOM's, for the same reason
    // the ESKOM call is last: after `seedPheCatalog`, PHEWB's `seedAssetGroups` pass and the
    // point-key catalog.
    await withOrganization(pool, phewbOrgId, async () => {
      await seedPhewbSiteLayouts(pool, phewbOrgId, pheCatalog);
    });

    // ── Post-tenant ───────────────────────────────────────────────────────
    await enforceHierarchyNotNull(pool);
    const { verifyHierarchySeed } = await import("./verify-hierarchy-seed.js");
    // The ladder seed's collision skips, so the verifier exempts exactly those
    // assets from its uncovered-asset check and logs each one.
    await verifyHierarchySeed(pool, { eskomOrgId, phewbOrgId }, { ladderCollisionSkips });
  } finally {
    await pool.end();
    await superuserPool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
