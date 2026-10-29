import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, type BmsDb } from "@bms/db";

import {
  assertADescendantIsInAndASiblingIsOut,
  assertAnAssetWithNoMappingListsTheMap,
  assertAPointWithNoSampleHasNullsAndTheCatalogUnit,
  assertAReadableIdsIntersectionDropsAnAssetInTheSubtree,
  assertOneAnswerPerPairInOrder,
  assertStatsComeFromTheSevenDayBuckets,
  assertTheDomainFilterApplies,
  assertTheInventoryListsExactlyTheRulePointSet,
  assertTheMappingUnitWhenTheWindowHasNoSample,
  createFixture,
  dropFixture,
  type Fixture,
} from "./site-point-inventory.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.288` (ADR 0099 Amendment 9 E2) — Vitest entry point. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle. The
 * gate's `bms_fleet` pool commits the fixture (a continuous aggregate cannot
 * see an uncommitted sample) and serves the reads, the pool the service is
 * given in the API.
 */
const connectionString = requireIntegrationDb({
  item: "F4.288",
  label: "site point inventory reads the rule point set and the 7-day buckets",
  because:
    "the claims are the rule point set read from bms.asset_points and template_points, the location " +
    "subtree, and the statistics of telemetry.point_values_1m; a fake would answer every one of them " +
    "while no row was read.",
});

describe.skipIf(!connectionString)("F4.288 — the site point inventory over a real database", () => {
  let pool: pg.Pool;
  let fleetDb: BmsDb;
  let fx: Fixture;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.288");
    fleetDb = createDb(pool);
    fx = await createFixture(pool, fleetDb);
  }, 180_000);

  afterAll(async () => {
    if (fx) await dropFixture(pool, fx);
    if (pool) await pool.end();
  }, 180_000);

  it("lists exactly the rule point set: the active mapped key, not the inactive one", () => assertTheInventoryListsExactlyTheRulePointSet(fleetDb, fx));
  it("lists the environment map for an asset with no mapped point", () => assertAnAssetWithNoMappingListsTheMap(fleetDb, fx));
  it("reads a descendant's asset and not a sibling's", () => assertADescendantIsInAndASiblingIsOut(fleetDb, fx));
  it("drops an asset inside the subtree that the caller does not read", () => assertAReadableIdsIntersectionDropsAnAssetInTheSubtree(fleetDb, fx));
  it("applies the domain filter", () => assertTheDomainFilterApplies(fleetDb, fx));
  it("takes min, max, samples, the composed mean and last from the 7-day buckets", () => assertStatsComeFromTheSevenDayBuckets(fleetDb, fx));
  it("answers a pair with no sample with nulls and the catalog unit", () => assertAPointWithNoSampleHasNullsAndTheCatalogUnit(pool, fleetDb, fx));
  it("falls back to the mapping's unit when the window has no sample", () => assertTheMappingUnitWhenTheWindowHasNoSample(fleetDb, fx));
  it("answers one row per asked pair, in order", () => assertOneAnswerPerPairInOrder(fleetDb, fx));
});
