import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "./access-control.service";
import {
  assertA10AllNullScopeIsStillRefusedNotThrown,
  assertA1AdminManagesAnyAssetScope,
  assertA2OrganizationAdminIsBoundToItsOwnOrganization,
  assertA3LocationAdminManagesAnAssetAtItsOwnLocation,
  assertA4LocationAdminRefusedAnAssetAtAnotherLocation,
  assertA5LocationAdminRefusedAForeignOrganizationStamp,
  assertA6AssetGroupAdminManagesAMemberAsset,
  assertA7AssetGroupAdminRefusedANonMemberAsset,
  assertA7bGroupInAnotherOrganizationDoesNotAuthorize,
  assertA8ViewerAndOperatorAreRefusedWithoutThrowing,
  assertA9TwoAxesSetIsFalseNotAThrow,
  assertFixturesAreDistinct,
  resolveAssetDashboardFixtures,
  type AssetDashboardFixtures,
} from "./access-control.asset-dashboard.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.2` Task 4 — Vitest entry point for `canManageDashboard`'s asset arm. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * One `it()` per claim, deliberately: an `expect` throws, so several claims in one block would
 * leave every claim after the first unreached — and A6/A7 (the membership join) and A3/A4
 * (`canManageLocation` on the asset's own location) are exactly the pairs where one half
 * passing while the other never runs looks identical to both passing.
 *
 * Both drizzle handles are the same `bms_fleet` connection, for the reason
 * `access-control.integration.test.ts`'s docblock gives at length: this suite proves query
 * correctness, not row-level security, and `bms_fleet` holds `BYPASSRLS` regardless of which
 * pool a query nominally runs through.
 */
const connectionString = requireIntegrationDb({
  item: "F3.2",
  label: "canManageDashboard's asset arm (ADR 0067 decision 2)",
  because:
    "which assets a location_admin or an asset_group_admin may scope a dashboard to is a fact " +
    "about real grant rows, real asset_group_members rows and a real assets.location_id — no " +
    "fake db can answer any of the ten claims below, and a suite that skipped them silently " +
    "would report green on an authorization surface.",
});

describe.skipIf(!connectionString)("F3.2 — canManageDashboard's asset arm", () => {
  let pool: pg.Pool | undefined;
  let svc: AccessControlService;
  let fixtures: AssetDashboardFixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F3.2");
    pool = created;
    const db = createDb(created);
    svc = new AccessControlService(db, db);
    fixtures = await resolveAssetDashboardFixtures(created);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  // First, because every claim below is vacuous or self-contradictory if two fixture ids
  // collapse onto one row.
  it("resolves nine distinct seeded fixtures", () => {
    assertFixturesAreDistinct(fixtures);
  });

  it("A1 — admin manages an asset-scoped dashboard in any organization", async () => {
    await assertA1AdminManagesAnyAssetScope(svc, fixtures);
  }, 60_000);

  it("A2 — organization_admin is bound to its own organization", async () => {
    await assertA2OrganizationAdminIsBoundToItsOwnOrganization(svc, fixtures);
  }, 60_000);

  it("A3 — location_admin manages an asset at its own location", async () => {
    await assertA3LocationAdminManagesAnAssetAtItsOwnLocation(svc, fixtures);
  }, 60_000);

  it("A4 — location_admin is refused an asset at another location of its organization", async () => {
    await assertA4LocationAdminRefusedAnAssetAtAnotherLocation(svc, fixtures);
  }, 60_000);

  it("A5 — location_admin's own asset does not authorize a foreign organization's stamp", async () => {
    await assertA5LocationAdminRefusedAForeignOrganizationStamp(svc, fixtures);
  }, 60_000);

  it("A6 — asset_group_admin manages a member asset of its own group", async () => {
    await assertA6AssetGroupAdminManagesAMemberAsset(svc, fixtures);
  }, 60_000);

  it("A7 — asset_group_admin is refused a non-member asset in the same organization", async () => {
    await assertA7AssetGroupAdminRefusedANonMemberAsset(svc, fixtures);
  }, 60_000);

  it("A7b — a group in another organization does not authorize this organization's asset", async () => {
    await assertA7bGroupInAnotherOrganizationDoesNotAuthorize(svc, pool as pg.Pool, fixtures);
  }, 60_000);

  it("A8 — viewer and operator are refused, not thrown", async () => {
    await assertA8ViewerAndOperatorAreRefusedWithoutThrowing(svc, fixtures);
  }, 60_000);

  it("A9 — a scope with both locationId and assetId set is false, never a throw", async () => {
    await assertA9TwoAxesSetIsFalseNotAThrow(svc, fixtures);
  }, 60_000);

  it("A10 — an all-null scope is still refused by the ruling-2 guard, never thrown", async () => {
    await assertA10AllNullScopeIsStillRefusedNotThrown(svc, fixtures);
  }, 60_000);
});
