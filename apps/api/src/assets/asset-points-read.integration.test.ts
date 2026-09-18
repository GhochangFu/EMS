import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import {
  assertAdminAssetGroupsListStillRefusesTheRole,
  assertAdminListStillRefusesTheRole,
  assertAdminLocationsListStillRefusesTheRole,
  assertEveryItemBelongsToTheAsset,
  assertEveryItemParsesUnderThePickerDto,
  assertEveryScopeGroupCarriesItsOwnOrganizationId,
  assertListPointsEqualsTheAdminProjection,
  assertListPointsReturnsTheActivePointsOfTheAsset,
  assertNoItemCarriesAnAdminOnlyField,
  assertRoleCannotReadAnAssetOutsideItsGroups,
  assertRoleCanReadItsOwnAsset,
  assertUnknownAssetIsNotFound,
  type Pools,
} from "./asset-points-read.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — Vitest entry point. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle, the `assets.service.integration.test.ts` shape: the gate's
 * `bms_fleet` pool serves the read, and `AccessControlService` resolves the
 * caller on `bms_auth` (`DATABASE_URL_AUTH`, else derived from the gate's URL).
 *
 * It has to be an integration suite: the claims are that a real group grant
 * admits a real seeded asset, that a real `active` predicate holds against a
 * committed inactive row, and that the admin projection and the new read
 * agree on real rows.
 */
const connectionString = requireIntegrationDb({
  item: "F3.63",
  label: "GET /assets/:assetId/points read tests",
  because:
    "a green run here would assert that an asset_group_admin can read the points of " +
    "an asset in its own group, cannot read one outside, and that the admin list " +
    "still refuses the role — while nothing checked any of it against a real " +
    "database. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.63 — the asset point read beside the master-data boundary", () => {
  let pool: pg.Pool;
  let authPool: pg.Pool;
  let pools: Pools;

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "F3.63");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.63",
    );
    pools = { pool, authDb: createDb(authPool), fleetDb: createDb(pool) };
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (authPool) {
      await authPool.end();
    }
  });

  it("the guard admits the role on an asset in its own group (positive control)", async () => {
    await assertRoleCanReadItsOwnAsset(pools);
  }, 60_000);

  it("listPoints returns exactly the asset's active points, and not a committed inactive one", async () => {
    await assertListPointsReturnsTheActivePointsOfTheAsset(pools);
  }, 60_000);

  it("every item belongs to the asset", async () => {
    await assertEveryItemBelongsToTheAsset(pools);
  }, 60_000);

  it("every item parses under assetPointPickerRowSchema", async () => {
    await assertEveryItemParsesUnderThePickerDto(pools);
  }, 60_000);

  it("no item carries an admin-only field — the key set is exactly the five picker fields", async () => {
    await assertNoItemCarriesAnAdminOnlyField(pools);
  }, 60_000);

  it("the guard refuses an asset outside the role's groups", async () => {
    await assertRoleCannotReadAnAssetOutsideItsGroups(pools);
  }, 60_000);

  it("an unknown asset is the service's NotFoundException", async () => {
    await assertUnknownAssetIsNotFound(pools);
  }, 60_000);

  it("GET /admin/asset-points still refuses asset_group_admin (the master-data gate did not move)", async () => {
    await assertAdminListStillRefusesTheRole(pools);
  }, 60_000);

  it("GET /admin/locations still refuses asset_group_admin, by the master-data message", async () => {
    await assertAdminLocationsListStillRefusesTheRole(pools);
  }, 60_000);

  it("GET /admin/asset-groups still refuses asset_group_admin, by the master-data message", async () => {
    await assertAdminAssetGroupsListStillRefusesTheRole(pools);
  }, 60_000);

  it("listPoints deep-equals the admin list's projection, picked to the five fields", async () => {
    await assertListPointsEqualsTheAdminProjection(pools);
  }, 60_000);

  it("every group in /auth/me's scope carries its own bms.asset_groups organization_id", async () => {
    await assertEveryScopeGroupCarriesItsOwnOrganizationId(pools);
  }, 60_000);
});
