import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  assertAFoldWithNoSampleIsNull,
  assertAnAssetOutsideThePairsChangesNothing,
  assertAnEmptyPairListSendsNoStatement,
  assertTheDayReadsTheFiveMinuteRelation,
  assertTheFirstBucketIsFrom,
  assertTheFoldIsTheWeightedMean,
  assertThePairsAreBoundAsArrays,
  assertTheWeekReadsTheHourRelation,
  assertTwoPairsReturnFortyEightBucketsEach,
  cleanupTrendStripReadFixture,
  setUpTrendStripReadFixture,
  type TrendStripReadFixture,
} from "./trend-strip-read.integration.spec";

/**
 * `F4.301` U2 — Vitest entry point for the trend strip's telemetry read.
 * Assertions live in the sibling `.spec` (§4.6); this file owns the pools and
 * the fixture.
 *
 * `connection: "owner"`: the fixture writes telemetry and refreshes the
 * production aggregates (`refreshAggregatesFrom` takes `bms_rollup`). The
 * organization and assets are written on the superuser pool (`bms.assets` is
 * FORCE-policied), and every read runs on the fleet pool, the pool the strip's
 * service reads on.
 */

const connectionString = requireIntegrationDb({
  item: "F4.301",
  label: "trend strip read",
  because:
    "the strip's fold is a weighted mean over a continuous aggregate, and its pair join is the only " +
    "isolation control on telemetry (no RLS); a pure test cannot check either.",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.301 U2 — the trend strip read against the aggregates", () => {
  let owner: pg.Pool | undefined;
  let superuser: pg.Pool | undefined;
  let fleet: pg.Pool | undefined;
  let fx: TrendStripReadFixture | undefined;

  beforeAll(async () => {
    const cs = connectionString as string;
    owner = await openIntegrationPool(cs, "F4.301");
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "superuser", process.env), "F4.301");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "fleet", process.env), "F4.301");
    fx = await setUpTrendStripReadFixture(superuser, owner);
  }, 180_000);

  afterAll(async () => {
    if (superuser && owner && fx) {
      await cleanupTrendStripReadFixture(superuser, owner, fx);
    }
    for (const pool of [fleet, superuser, owner]) {
      await pool?.end().catch(() => undefined);
    }
  }, 120_000);

  const run = (assertion: (fleet: pg.Pool, fx: TrendStripReadFixture) => Promise<void>) => async () => {
    if (!fleet || !fx) throw new Error("fixture required");
    await assertion(fleet, fx);
  };

  it("R1 two pairs over 24 h return exactly 48 buckets each after gap-fill", run(assertTwoPairsReturnFortyEightBucketsEach));
  it("R1 the first bucket starts at the aligned from", run(assertTheFirstBucketIsFrom));
  it("R1 a fold with no sample is null", run(assertAFoldWithNoSampleIsNull));
  it("R2 a 30-minute fold over _5m rows of counts 3 and 1 is the weighted mean", run(assertTheFoldIsTheWeightedMean));
  it("R3 an asset with samples outside the pairs reaches no row", run(assertAnAssetOutsideThePairsChangesNothing));
});

/** Statement text and parameters, through a recording pool. Ungated: no database. */
describe("F4.301 U2 — the trend strip read's statement", () => {
  it("R4 the pairs are bound as unnest arrays with no IS NULL OR leg", assertThePairsAreBoundAsArrays);
  it("R4 24 h names telemetry.point_values_5m and never raw", assertTheDayReadsTheFiveMinuteRelation);
  it("R4 7 d names telemetry.point_values_1h and never raw", assertTheWeekReadsTheHourRelation);
  it("R5 an empty pair list returns [] and sends no statement", assertAnEmptyPairListSendsNoStatement);
});
