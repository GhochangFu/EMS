import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  assertADaySeriesPointIsTheLocalDay,
  assertAnEmptyScopeSendsNoOrganizationStatement,
  assertAnEmptyWindowIsAbsent,
  assertASiteCountsDistinctBuckets,
  assertAssetWindowRowsCarryKwhAndBuckets,
  assertEntityWindowReadsBindsTheList,
  assertHeatmapReadBindsTheListAndTheZone,
  assertLocationIdsNarrowTheSites,
  assertOneIdSendsOneOrganizationStatementPerRead,
  assertSiteEnergyReadBindsTheList,
  assertSiteKwhSumsToTheTotal,
  assertSitesCarryTheirAssetCount,
  assertSiteSeriesReadBindsTheListAndTheZone,
  assertTheFallBackHourSumsTwoBuckets,
  assertTheForeignAssetIsOutsideTheHeatmap,
  assertTheForeignAssetIsOutsideTheSiteRanking,
  assertTheForeignAssetIsOutsideTheSiteSeries,
  assertTheForeignAssetIsOutsideTheWindowReads,
  assertTheHeatmapHourIsTheLocalHour,
  assertTheHeatmapSumsToTheTotal,
  assertTheLimitCutsTheRowsNotTheCount,
  assertTheRestFoldIntoOther,
  assertTheSeriesIsOneAlignedGrid,
  assertTheSiteNameIsTheLocationName,
  assertTheSpikeSiteReportsItsPeak,
  assertTheSpringForwardDayHasNoHourTwo,
  cleanupDstFixture,
  setUpDstFixture,
  type DstFixture,
} from "./energy-organization-reads.integration.spec";
import {
  cleanupEnergyViewReadFixture,
  setUpEnergyViewReadFixture,
  type EnergyViewReadFixture,
} from "./energy-view-read.integration.spec";

/**
 * `F4.299` U3 — Vitest entry point for the organization views' reads.
 * Assertions live in the sibling `.spec` (§4.6); this file owns the pools and
 * both fixtures.
 *
 * `connection: "owner"`: the fixtures write telemetry and refresh the
 * production aggregates. Organizations and assets are written on the superuser
 * pool (`bms.assets` is FORCE-policied); every read runs on the fleet pool, the
 * pool the reports path reads on.
 */

const connectionString = requireIntegrationDb({
  item: "F4.299",
  label: "energy organization views reads",
  because:
    "the per-site kWh, the site series, the local-hour heatmap and the baseline windows are SQL over a " +
    "continuous aggregate, and the asset filter is the only isolation control on telemetry (no RLS).",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.299 U3 — the organization views' reads against the aggregates", () => {
  let owner: pg.Pool | undefined;
  let superuser: pg.Pool | undefined;
  let fleet: pg.Pool | undefined;
  let fx: EnergyViewReadFixture | undefined;
  let dst: DstFixture | undefined;

  beforeAll(async () => {
    const cs = connectionString as string;
    owner = await openIntegrationPool(cs, "F4.299");
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "superuser", process.env), "F4.299");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "fleet", process.env), "F4.299");
    fx = await setUpEnergyViewReadFixture(superuser, owner);
    dst = await setUpDstFixture(superuser, owner);
  }, 300_000);

  afterAll(async () => {
    if (superuser && owner && fx) {
      await cleanupEnergyViewReadFixture(superuser, owner, fx);
    }
    if (superuser && owner && dst) {
      await cleanupDstFixture(superuser, owner, dst);
    }
    for (const pool of [fleet, superuser, owner]) {
      await pool?.end().catch(() => undefined);
    }
  }, 300_000);

  const run = (assertion: (fleet: pg.Pool, fx: EnergyViewReadFixture) => Promise<void>) => async () => {
    if (!fleet || !fx) throw new Error("fixture required");
    await assertion(fleet, fx);
  };
  const runDst = (assertion: (fleet: pg.Pool, fx: DstFixture) => Promise<void>) => async () => {
    if (!fleet || !dst) throw new Error("DST fixture required");
    await assertion(fleet, dst);
  };

  it("siteEnergyRead: the sites' kWh sum to energyPeriodRead's totalKwh", run(assertSiteKwhSumsToTheTotal));
  it("siteEnergyRead: the spike's site reports its bucket and summed kW", run(assertTheSpikeSiteReportsItsPeak));
  it("siteEnergyRead: each site carries its asset count, in kWh order", run(assertSitesCarryTheirAssetCount));
  it("siteEnergyRead: the name is bms.locations.name", run(assertTheSiteNameIsTheLocationName));
  it("siteEnergyRead: the limit cuts the rows, not totalSites", run(assertTheLimitCutsTheRowsNotTheCount));
  it("siteEnergyRead: locationIds narrows the sites", run(assertLocationIdsNarrowTheSites));
  it("siteSeriesRead: one aligned grid, no other column with two sites", run(assertTheSeriesIsOneAlignedGrid));
  it("siteSeriesRead: siteLimit 1 folds the second site into other", run(assertTheRestFoldIntoOther));
  it("siteSeriesRead: a 1d bucket in Asia/Kolkata is the local day", run(assertADaySeriesPointIsTheLocalDay));
  it("heatmapRead: a 10:00Z bucket is local hour 15 in Asia/Kolkata", run(assertTheHeatmapHourIsTheLocalHour));
  it("heatmapRead: the cells sum to energyPeriodRead's totalKwh", run(assertTheHeatmapSumsToTheTotal));
  it("heatmapRead: the New York fall-back sums its two 01:00 buckets", runDst(assertTheFallBackHourSumsTwoBuckets));
  it("heatmapRead: the New York spring-forward day has no hour 2", runDst(assertTheSpringForwardDayHasNoHourTwo));
  it("entityWindowReads: asset rows carry kWh and distinct bucket count", run(assertAssetWindowRowsCarryKwhAndBuckets));
  it("entityWindowReads: a site counts distinct buckets, not a sum over assets", run(assertASiteCountsDistinctBuckets));
  it("entityWindowReads: an empty window is absent", run(assertAnEmptyWindowIsAbsent));
  it("the foreign asset changes nothing in siteEnergyRead", run(assertTheForeignAssetIsOutsideTheSiteRanking));
  it("the foreign asset changes nothing in siteSeriesRead", run(assertTheForeignAssetIsOutsideTheSiteSeries));
  it("the foreign asset changes nothing in heatmapRead", run(assertTheForeignAssetIsOutsideTheHeatmap));
  it("the foreign asset changes nothing in entityWindowReads", run(assertTheForeignAssetIsOutsideTheWindowReads));
});

/** Statement text and parameters, through a local recording pool. Ungated: no database. */
describe("F4.299 U3 — the organization views' statements", () => {
  it("siteEnergyRead binds the scope's list (and locationIds' list)", assertSiteEnergyReadBindsTheList);
  it("siteSeriesRead binds the list and the zone at displayGroupExpr's index", assertSiteSeriesReadBindsTheListAndTheZone);
  it("heatmapRead binds the list and the zone as a parameter", assertHeatmapReadBindsTheListAndTheZone);
  it("entityWindowReads binds the list over grouping sets", assertEntityWindowReadsBindsTheList);
  it("an empty scope returns the empty results and sends no statement", assertAnEmptyScopeSendsNoOrganizationStatement);
  it("one id sends one statement per read", assertOneIdSendsOneOrganizationStatementPerRead);
});
