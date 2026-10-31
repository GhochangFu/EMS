import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  assertADayBucketIsTheLocalDay,
  assertADayBucketNeverNamesTheUtcDayRelation,
  assertAnEmptyPeriodHasNoData,
  assertAnEmptyScopeSendsNoStatement,
  assertAnUnsupportedLevelAndBucketIsRefused,
  assertAveragePfBindsTheList,
  assertAveragePfIsNullWithNoPfRow,
  assertAveragePfIsSampleWeighted,
  assertOneIdSendsOneStatementPerRead,
  assertTheComparePeriodStopsBeforeTheStart,
  assertTheForeignAssetIsOutsideAveragePf,
  assertTheForeignAssetIsOutsideThePeriodRead,
  assertTheForeignAssetIsOutsideTopConsumers,
  assertThePeakIsTheSpikeBucket,
  assertThePeriodReadBindsTheList,
  assertTopConsumersMatchThePreview,
  assertTotalKwhMatchesThePreview,
  assertViewTopConsumersBindsTheList,
  cleanupEnergyViewReadFixture,
  setUpEnergyViewReadFixture,
  type EnergyViewReadFixture,
} from "./energy-view-read.integration.spec";

/**
 * `F4.298` U3 — Vitest entry point for the energy view reads. Assertions live in
 * the sibling `.spec` (§4.6); this file owns the pools and the fixture.
 *
 * `connection: "owner"`: the fixture writes telemetry and refreshes the
 * production aggregates (`refreshAggregatesFrom` takes `bms_rollup`). The
 * organizations and assets are written on the superuser pool (`bms.assets` is
 * FORCE-policied), and every read runs on the fleet pool, the pool the
 * reports path reads on.
 */

const connectionString = requireIntegrationDb({
  item: "F4.298",
  label: "energy view reads",
  because:
    "the view's kWh, peak, PF and local-day bucket are SQL over a continuous aggregate, and its " +
    "asset filter is the only isolation control on telemetry (no RLS); a pure test cannot check either.",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.298 U3 — the energy view reads against the aggregates", () => {
  let owner: pg.Pool | undefined;
  let superuser: pg.Pool | undefined;
  let fleet: pg.Pool | undefined;
  let fx: EnergyViewReadFixture | undefined;

  beforeAll(async () => {
    const cs = connectionString as string;
    owner = await openIntegrationPool(cs, "F4.298");
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "superuser", process.env), "F4.298");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "fleet", process.env), "F4.298");
    fx = await setUpEnergyViewReadFixture(superuser, owner);
  }, 180_000);

  afterAll(async () => {
    if (superuser && owner && fx) {
      await cleanupEnergyViewReadFixture(superuser, owner, fx);
    }
    for (const pool of [fleet, superuser, owner]) {
      await pool?.end().catch(() => undefined);
    }
  }, 120_000);

  const run = (assertion: (fleet: pg.Pool, fx: EnergyViewReadFixture) => Promise<void>) => async () => {
    if (!fleet || !fx) throw new Error("fixture required");
    await assertion(fleet, fx);
  };

  it("over one UTC day the kWh and solar kWh equal the preview's", run(assertTotalKwhMatchesThePreview));
  it("peakAt is the _1h bucket of the spike and peakKw its summed kW", run(assertThePeakIsTheSpikeBucket));
  it("average PF is the sample-weighted mean across two assets", run(assertAveragePfIsSampleWeighted));
  it("average PF is null when the period has no pf row", run(assertAveragePfIsNullWithNoPfRow));
  it("the compare period reads no bucket at or after the current start", run(assertTheComparePeriodStopsBeforeTheStart));
  it("an empty period has no data", run(assertAnEmptyPeriodHasNoData));
  it("a 1d bucket in Asia/Kolkata is the local day over _1h", run(assertADayBucketIsTheLocalDay));
  it("an asset of another organization changes nothing in energyPeriodRead", run(assertTheForeignAssetIsOutsideThePeriodRead));
  it("an asset of another organization changes nothing in averagePf", run(assertTheForeignAssetIsOutsideAveragePf));
  it("an asset of another organization is never listed by viewTopConsumers", run(assertTheForeignAssetIsOutsideTopConsumers));
  it("the moved top-consumers read equals the preview's", run(assertTopConsumersMatchThePreview));
});

/** Statement text and parameters, through a recording pool. Ungated: no database. */
describe("F4.298 U3 — the energy view reads' statements", () => {
  it("energyPeriodRead binds the scope's list and has no IS NULL OR leg", assertThePeriodReadBindsTheList);
  it("averagePf binds the scope's list and has no IS NULL OR leg", assertAveragePfBindsTheList);
  it("viewTopConsumers sends the moved statement with $4 bound to the list", assertViewTopConsumersBindsTheList);
  it("a 1d bucket reads _1h by the zone day and never names _1d", assertADayBucketNeverNamesTheUtcDayRelation);
  it("an unsupported level and bucket pair is refused before any statement", assertAnUnsupportedLevelAndBucketIsRefused);
  it("an empty scope returns the empty result and sends no statement", assertAnEmptyScopeSendsNoStatement);
  it("one id sends one statement per read", assertOneIdSendsOneStatementPerRead);
});
