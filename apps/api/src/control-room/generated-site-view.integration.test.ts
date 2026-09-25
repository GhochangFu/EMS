import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { inRolledBackTransaction } from "../dashboard/dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  type ForUserCtx,
  assertAssetGroupAdminGetsItsMembers,
  assertAssetGroupAdminMissesANonMember,
  assertAssetIdsNarrowTheRead,
  assertCatalogUnitFillsNull,
  assertDomainsInSortOrder,
  assertEmptyScopeSendsNoQuery,
  assertGlobalAdminReadsAPhewbSite,
  assertInactivePointIsAbsent,
  assertLatestIsTheNewerSample,
  assertNoSampleIsNone,
  assertNoSampleIsNullLatest,
  assertOrganizationAdminIsBoundToItsOrganization,
  assertRankThenNullsLast,
  assertTemplatelessAssetsAreAnswered,
  assertTheBoundaryIsLive,
  assertThirtySecondsIsStale,
  assertThreeAssetsCostTwoStatements,
  assertTieOrdersByKey,
  assertTwentyTwoSecondsIsLive,
  assertUnitOverrideWins,
  assertUnknownLocationIsNotFound,
  assertUnrankedOrdersByKey,
} from "./generated-site-view.integration.spec";
import { GeneratedSiteViewService } from "./generated-site-view.service";

/**
 * `F3.68` — Vitest entry point for `GeneratedSiteViewService` against a real
 * database (plan U5, R1–R14). Assertions live in the sibling `.spec` (ADR
 * 0014); this file owns the pools.
 *
 * The `read()` cases run on the fleet pool (production's `FLEET_POOL`, ADR
 * 0043), each inside a transaction the spec's harness rolls back, so they
 * commit nothing. The `forUser()` cases read seeded rows only and write
 * nothing, so there is no `afterAll` cleanup to do beyond closing the pools.
 */
const connectionString = requireIntegrationDb({
  item: "F3.68",
  label: "the generated site view read",
  because:
    "the point order (rank, NULLS LAST, key), the DISTINCT ON latest value, the active-point filter, " +
    "the unit COALESCE and the asset-id scope predicate are all SQL, so a green run without a " +
    "database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.68 — GeneratedSiteViewService", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let ctx: ForUserCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F3.68");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.68",
    );

    const { rows: rsmoc } = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'",
    );
    if (!rsmoc[0]) throw new Error("F3.68: RSMOC-WC is not seeded — run pnpm db:seed.");

    // One seeded, active PHEWB site that holds assets: phe-admin's read scope is
    // active locations only, and an empty site would make R11's control vacuous.
    const { rows: pheSite } = await fleetPool.query<{ id: string }>(
      `SELECT l.id FROM bms.locations l
         JOIN bms.organizations o ON o.id = l.organization_id
        WHERE o.code = 'PHEWB' AND l.active
          AND EXISTS (SELECT 1 FROM bms.assets a WHERE a.location_id = l.id)
        ORDER BY l.code LIMIT 1`,
    );
    if (!pheSite[0]) throw new Error("F3.68: no active PHEWB site with assets is seeded — run pnpm db:seed.");

    ctx = {
      svc: new GeneratedSiteViewService(fleetPool, new AccessControlService(createDb(authPool), createDb(fleetPool))),
      fleetPool,
      rsmocWcId: rsmoc[0].id,
      pheSiteId: pheSite[0].id,
    };
  }, 60_000);

  afterAll(async () => {
    await Promise.all([fleetPool?.end(), authPool?.end()]);
  }, 60_000);

  const rolledBack = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(fleetPool, fn);

  it("R1 two assets in two domains answer two panels in sort_order", rolledBack(assertDomainsInSortOrder), 60_000);
  it("R2 ranks 2,1,NULL,NULL on keys d,c,b,a order c,d,a,b", rolledBack(assertRankThenNullsLast), 60_000);
  it("R3 an equal rank orders by point_key", rolledBack(assertTieOrdersByKey), 60_000);
  it("R4 an asset with no ranked point orders by point_key", rolledBack(assertUnrankedOrdersByKey), 60_000);
  it("R5a latest is the newer of two samples", rolledBack(assertLatestIsTheNewerSample), 60_000);
  it("R5b a point with no sample answers latest: null", rolledBack(assertNoSampleIsNullLatest), 60_000);
  it("R6 an inactive asset point is absent, its active sibling present", rolledBack(assertInactivePointIsAbsent), 60_000);
  it("R7a the asset point's unit overrides the catalog unit", rolledBack(assertUnitOverrideWins), 60_000);
  it("R7b the catalog unit fills a NULL asset-point unit", rolledBack(assertCatalogUnitFillsNull), 60_000);
  it("R8a a newest sample 22 s old is live", rolledBack(assertTwentyTwoSecondsIsLive), 60_000);
  it("R8b a newest sample 30 s old is stale", rolledBack(assertThirtySecondsIsStale), 60_000);
  it("R8c no sample is none", rolledBack(assertNoSampleIsNone), 60_000);
  it("R8d a newest sample exactly 25 s old is live", rolledBack(assertTheBoundaryIsLive), 60_000);
  it("R9a assetIds [a] answers only a, in two statements", rolledBack(assertAssetIdsNarrowTheRead), 60_000);
  it("R9b assetIds [] answers no domains and sends no query", rolledBack(assertEmptyScopeSendsNoQuery), 60_000);
  it("R9c three assets still cost two statements", rolledBack(assertThreeAssetsCostTwoStatements), 60_000);
  it("R10 template-less assets are all answered", rolledBack(assertTemplatelessAssetsAreAnswered), 60_000);
  it("R14 an unknown location id is the F3.67 404", rolledBack(assertUnknownLocationIsNotFound), 60_000);

  it("R11 phe-admin reads a PHEWB site whole, then gets 404 on RSMOC-WC", async () => {
    await assertOrganizationAdminIsBoundToItsOrganization(ctx);
  }, 60_000);

  it("R12a wc-hvac-admin on RSMOC-WC gets at least one asset, exactly its group members", async () => {
    await assertAssetGroupAdminGetsItsMembers(ctx);
  }, 60_000);

  it("R12b wc-hvac-admin on RSMOC-WC does not get a non-member asset", async () => {
    await assertAssetGroupAdminMissesANonMember(ctx);
  }, 60_000);

  it("R13 admin reads a PHEWB site", async () => {
    await assertGlobalAdminReadsAPhewbSite(ctx);
  }, 60_000);
});
