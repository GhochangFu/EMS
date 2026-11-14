import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import {
  assertAnotherOrganizationChangesNothing,
  assertAReportEndingOnAMonthsLastDayIsThatMonth,
  assertATwoMonthReportPricesEachMonthAtItsRate,
  assertASecondaryVersionNeedsVerifying,
  assertTheDashboardPricesMonthToDate,
  assertTheReportPricesAMappedSiteAtItsBillRate,
  cleanupRateFixture,
  seedRateFixture,
  type RateFixture,
} from "./energy-rate-resolver.integration.spec";

/** `F4.365` U7 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
const connectionString = requireIntegrationDb({
  item: "F4.365",
  label: "slab rates in the cost reads",
  because: "the rate is a bill over register deltas in a local month, composed with the per-asset kWh read and the flat parameter on the fleet pool.",
});

describe.skipIf(!connectionString)("F4.365 — slab rates in the cost reads (ADR 0134 decision 7)", () => {
  let superuser: pg.Pool;
  let fleet: pg.Pool;
  let fx: RateFixture;

  beforeAll(async () => {
    const url = connectionString as string;
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.365");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.365");
    await cleanupRateFixture(superuser);
    fx = await seedRateFixture(superuser);
  }, 180_000);

  afterAll(async () => {
    if (superuser) {
      await cleanupRateFixture(superuser, fx);
      await superuser.end();
    }
    await fleet?.end();
  }, 180_000);

  it("prices a mapped site's report at its bill rate and the unmapped one at the flat parameter", () =>
    assertTheReportPricesAMappedSiteAtItsBillRate(fleet, fx));
  it("raises tariffVerify for a secondary version", () => assertASecondaryVersionNeedsVerifying(fleet, fx));
  it("prices the dashboard's trailing window month to date, fixed charge prorated", (ctx) => {
    // Deterministic everywhere but the first half hour of a Kolkata month (`RateFixture.liveSkip`).
    if (fx.liveSkip !== null) ctx.skip(fx.liveSkip);
    return assertTheDashboardPricesMonthToDate(fleet, fx);
  });
  it("prices a report ending on a month's last local day at that month's full bill", () =>
    assertAReportEndingOnAMonthsLastDayIsThatMonth(fleet, fx));
  it("prices a two-month report with each month at its own rate", () => assertATwoMonthReportPricesEachMonthAtItsRate(fleet, fx));
  it("ignores another organization's mapping and revision", () => assertAnotherOrganizationChangesNothing(fleet, fx));
});
