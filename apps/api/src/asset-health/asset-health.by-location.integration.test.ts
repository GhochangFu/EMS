import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAChildDoesNotMoveItsParent,
  assertAScoredAndAnUnscoredLocation,
  assertAnAssetOutsideTheScopeIsNotScored,
  assertAnInactiveAssetIsNotScored,
  assertParityWithTheSummaryOnALeaf,
  assertThreeLocationsCostTheSameAsOne,
} from "./asset-health.by-location.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.364` — Vitest entry point for `scoresByLocation`. Assertions live in the sibling `.spec`
 * (§4.6); this file owns the fleet pool. Every case rolls its own transaction back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.364",
  label: "health scores by location integration tests",
  because:
    "which assets a location card's health score covers, and that it costs the same statements for " +
    "any number of locations, is SQL inside scoresByLocation; a green run without a database asserts nothing.",
});

describe.skipIf(!connectionString)("F4.364 — AssetHealthService.scoresByLocation", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.364");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("H1 — a scored location and an unscored one", async () => {
    await assertAScoredAndAnUnscoredLocation(pool);
  }, 60_000);

  it("H2 — equals summary(locationId).score on a leaf", async () => {
    await assertParityWithTheSummaryOnALeaf(pool);
  }, 60_000);

  it("H3 — a child location's asset does not move its parent's score (Q3)", async () => {
    await assertAChildDoesNotMoveItsParent(pool);
  }, 60_000);

  it("H4 — an inactive asset is not scored", async () => {
    await assertAnInactiveAssetIsNotScored(pool);
  }, 60_000);

  it("H5 — an asset outside assetIds does not move the score", async () => {
    await assertAnAssetOutsideTheScopeIsNotScored(pool);
  }, 60_000);

  it("H6 — three locations cost the same statements as one (the N+1 gate)", async () => {
    await assertThreeLocationsCostTheSameAsOne(pool);
  }, 60_000);
});
