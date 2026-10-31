import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import {
  assertACustomRangeReadsExactlyItsBuckets,
  assertAnInvalidLocationZoneFallsToTheOrganization,
  assertANullLocationFallsToTheOrganization,
  assertAnOutsiderOnTheSameKeyIsNotRead,
  assertAStoredUtcIsReportedAsUtc,
  assertBucketStatsCarryMinAverageMax,
  assertBucketsWithoutStatsCarryNoStatistics,
  assertCompareBucketsCoverThePrecedingPeriod,
  assertTheFixtureIsVisible,
  assertTheLocationZoneWins,
  cleanup,
  emptyFixtures,
  setupFixtures,
  type Fixtures,
} from "./point-aggregate.integration.spec";

/**
 * `F4.297` — Vitest entry point for `pointAggregate` against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle. The fleet pool plants the telemetry rows and serves the
 * service; the superuser pool writes and deletes the zone fixtures in
 * `bms.*` (FORCE Row Level Security).
 */
const connectionString = requireIntegrationDb({
  item: "F4.297",
  label: "point aggregate tests",
  because:
    "the custom from/to buckets, the compare window's buckets, the weighted per-bucket statistics, " +
    "the asset_id containment on telemetry.point_values_1m and the site-zone chain over bms.locations " +
    "and bms.organizations are engine behaviour.",
});

describe.skipIf(!connectionString)("F4.297 — pointAggregate against Postgres", () => {
  let pool: pg.Pool | undefined;
  let superPool: pg.Pool | undefined;
  let fx: Fixtures | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "F4.297");
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.297");
    fx = emptyFixtures();
    fx = await setupFixtures(pool, superPool, fx);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, superPool, fx).catch(() => undefined);
    }
    await Promise.all([pool?.end(), superPool?.end()]);
  }, 60_000);

  const use = (): [pg.Pool, Fixtures] => [pool as pg.Pool, fx as Fixtures];

  it("serves the far-future fixture through the real-time branch", async () => {
    await assertTheFixtureIsVisible(...use());
  });

  it("reads exactly the custom range's gap-filled buckets", async () => {
    await assertACustomRangeReadsExactlyItsBuckets(...use());
  });

  it("returns the preceding period's buckets at their true timestamps", async () => {
    await assertCompareBucketsCoverThePrecedingPeriod(...use());
  });

  it("carries min, weighted mean, max and sample count per bucket with bucketStats", async () => {
    await assertBucketStatsCarryMinAverageMax(...use());
  });

  it("carries t and v only without bucketStats", async () => {
    await assertBucketsWithoutStatsCarryNoStatistics(...use());
  });

  it("keeps another asset's samples on the same key out of every statistic and bucket", async () => {
    await assertAnOutsiderOnTheSameKeyIsNotRead(...use());
  });

  it("answers the location's zone when it is valid", async () => {
    await assertTheLocationZoneWins(...use());
  });

  it("falls to the organization's zone when the location has none", async () => {
    await assertANullLocationFallsToTheOrganization(...use());
  });

  it("reports a stored UTC organization zone as UTC", async () => {
    await assertAStoredUtcIsReportedAsUtc(...use());
  });

  it("falls past an invalid stored location zone to the organization's, without a 500", async () => {
    await assertAnInvalidLocationZoneFallsToTheOrganization(...use());
  });
});
