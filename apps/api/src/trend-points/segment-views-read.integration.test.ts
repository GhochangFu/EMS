import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import {
  type SegmentViewsReadFixture,
  assertADayBucketIsALocalDay,
  assertAnEmptyListSendsNoStatement,
  assertCompareBucketsKeepTheirTimestamps,
  assertStatementABindsThePointAndTheList,
  assertStatementAReadsTheLevelsRelation,
  assertStatementBBindsThePairs,
  assertTheBucketCountIsDistinct,
  assertTheCompareRowAndTheAssetBound,
  assertTheMaxAndItsBucket,
  assertTheMeanIsWeighted,
  cleanupSegmentViewsReadFixture,
  setUpSegmentViewsReadFixture,
} from "./segment-views-read.integration.spec";

/**
 * `F4.302` U2 — Vitest entry point for the segment view's two telemetry
 * statements. Assertions live in the sibling `.spec` (§4.6); this file owns
 * the pools and the fixture.
 *
 * `connection: "owner"`: the fixture writes telemetry and refreshes the
 * production aggregates (`refreshAggregatesFrom` takes `bms_rollup`). The
 * organization and assets are written on the superuser pool (`bms.assets` is
 * FORCE-policied), and every read runs on the fleet pool, the pool the
 * service reads on.
 */

const connectionString = requireIntegrationDb({
  item: "F4.302",
  label: "segment views read",
  because:
    "the ranking mean is a weighted mean over a continuous aggregate, a 1d bucket is a local day of " +
    "time_bucket with a zone, and the asset bound is the only isolation control on telemetry (no RLS); " +
    "a pure test cannot check any of them.",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.302 U2 — the segment views reads against the aggregates", () => {
  let owner: pg.Pool | undefined;
  let superuser: pg.Pool | undefined;
  let fleet: pg.Pool | undefined;
  let fx: SegmentViewsReadFixture | undefined;

  beforeAll(async () => {
    const cs = connectionString as string;
    owner = await openIntegrationPool(cs, "F4.302");
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "superuser", process.env), "F4.302");
    fleet = await openIntegrationPool(resolveIntegrationRoleUrl(cs, "fleet", process.env), "F4.302");
    fx = await setUpSegmentViewsReadFixture(superuser, owner);
  }, 180_000);

  afterAll(async () => {
    if (superuser && owner && fx) {
      await cleanupSegmentViewsReadFixture(superuser, owner, fx);
    }
    for (const pool of [fleet, superuser, owner]) {
      await pool?.end().catch(() => undefined);
    }
  }, 120_000);

  const run = (assertion: (fleet: pg.Pool, fx: SegmentViewsReadFixture) => Promise<void>) => async () => {
    if (!fleet || !fx) throw new Error("fixture required");
    await assertion(fleet, fx);
  };

  it("A the mean over _5m rows of counts 3 and 1 is the weighted mean 1.75", run(assertTheMeanIsWeighted));
  it("A max is max(max_value) with its bucket", run(assertTheMaxAndItsBucket));
  it("A bucket_count counts distinct buckets", run(assertTheBucketCountIsDistinct));
  it("A the compare window is its own row and an asset outside the list reaches none", run(assertTheCompareRowAndTheAssetBound));
  it("B a 1d bucket in Asia/Kolkata puts a 20:10Z row on the next local day; gaps are null", run(assertADayBucketIsALocalDay));
  it("B compare buckets keep their own timestamps", run(assertCompareBucketsKeepTheirTimestamps));
});

/** Statement text and parameters, through a recording pool. Ungated: no database. */
describe("F4.302 U2 — the segment views statements' shape", () => {
  it("A binds the point as $4 and the list as $5, no IS NULL OR, no literal point", assertStatementABindsThePointAndTheList);
  it("A reads aggregateRelation(level), never raw", assertStatementAReadsTheLevelsRelation);
  it("B binds the asset list, both windows and the point; the zone only for a 1d bucket", assertStatementBBindsThePairs);
  it("an empty list sends neither statement", assertAnEmptyListSendsNoStatement);
});
