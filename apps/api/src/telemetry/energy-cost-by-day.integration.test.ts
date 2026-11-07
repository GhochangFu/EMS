import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { MetricCatalogService } from "../dashboard-builder/metric-catalog.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertADstFallBackDayHasTwentyFiveHours,
  assertAMidDayRateChangeSplitsTheDay,
  assertAMissingRateIsNullWithTheReason,
  assertAnEditedOldRateRepricesOnlyItsDays,
  assertAnotherOrganizationsAssetsAreNotPriced,
  assertAnotherOrganizationsIdIsDropped,
  assertKolkataLocalMidnightIsTheBoundary,
  assertTheResolveStaysInsideTheOrganization,
  assertTheRunningHourCountsOnlyTheTimePassed,
  cleanupCostByDay,
  seedCostByDayFixture,
  type CostByDayFixture,
} from "./energy-cost-by-day.integration.spec";

/**
 * `F4.332` — Vitest entry point for the cost per local day against a real database. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the lifecycle: the fixture is seeded and
 * materialised once, and each case reads it (the edit case restores its row in a `finally`).
 */

const connectionString = requireIntegrationDb({
  item: "F4.332",
  label: "the energy cost per local day",
  because:
    "the cost is the composition of the 5-minute aggregate folded into local hours, the dated " +
    "rate rows at the nearest scope and the catalog's tenant-bounded scope — facts about real " +
    "rows, time_bucket's zone arithmetic and a real tenant transaction.",
});

describe.skipIf(!connectionString)("F4.332 — the energy cost per local day (ADR 0070 Amendment 7)", () => {
  let superuser: pg.Pool;
  let fleet: pg.Pool;
  let tenant: pg.Pool;
  let service: MetricCatalogService;
  let fx: CostByDayFixture;

  beforeAll(async () => {
    const url = connectionString as string;
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.332");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.332");
    tenant = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.332",
    );
    const fleetDb = createDb(fleet);
    service = new MetricCatalogService(
      createDb(tenant),
      fleetDb,
      // `accessControl` is never reached: this suite drives `resolveBindings`.
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
      fleet,
    );
    await cleanupCostByDay(superuser);
    fx = await seedCostByDayFixture(superuser);
  }, 120_000);

  afterAll(async () => {
    if (superuser) {
      await cleanupCostByDay(superuser, fx);
      await superuser.end();
    }
    await fleet?.end();
    await tenant?.end();
  }, 120_000);

  it("splits a day at a mid-day rate change", () => assertAMidDayRateChangeSplitsTheDay(fleet, fx));
  it("draws the day boundary at local midnight in Asia/Kolkata", () => assertKolkataLocalMidnightIsTheBoundary(fleet, fx));
  it("re-prices only the days an edited old rate row covers", () =>
    assertAnEditedOldRateRepricesOnlyItsDays(fleet, superuser, fx));
  it("answers null with rate_missing when no rate is in scope", () => assertAMissingRateIsNullWithTheReason(fleet, fx));
  it("drops another organization's asset id from the read", () => assertAnotherOrganizationsIdIsDropped(fleet, fx));
  it("resolves inside the organization and the reader's readable set", () =>
    assertTheResolveStaysInsideTheOrganization(service, fx));
  it("never prices another organization's assets", () => assertAnotherOrganizationsAssetsAreNotPriced(service, fx));
  it("counts the running hour by the time passed", () => assertTheRunningHourCountsOnlyTheTimePassed(fleet, fx));
  it("counts a DST fall-back day as 25 local hours", () => assertADstFallBackDayHasTwentyFiveHours(fleet, fx));
});
