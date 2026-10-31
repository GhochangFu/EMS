import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, type BmsDb } from "@bms/db";

import {
  assertAMapKeyIsStillAccepted,
  assertAnotherAssetGetsOnlyTheMap,
  assertTheActiveMappedKeyIsAccepted,
  assertTheActiveMappedKeyIsOffered,
  assertTheInactiveMappedKeyIsRefused,
  createFixture,
  dropFixture,
  type Fixture,
} from "./rule-points.asset-points.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.287` (ADR 0058 Amendment 4) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle. The gate's
 * `bms_fleet` pool commits the fixture and serves both reads, the pool
 * `RulesService` hands `ruleTargetPointKeysByAsset` and `assertCompatiblePoint`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.287",
  label: "rule point set reads the asset's active points",
  because:
    "the claim is that the rule point set reads bms.asset_points with an active filter, and the " +
    "unit fake ignores every predicate — a green run without a database would assert that a " +
    "mapped key is offered and an inactive one refused while no row was read.",
});

describe.skipIf(!connectionString)("F4.287 — a threshold rule can target any point its asset reports", () => {
  let pool: pg.Pool;
  let fleetDb: BmsDb;
  let fx: Fixture;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.287");
    fleetDb = createDb(pool);
    fx = await createFixture(pool, fleetDb);
  });

  afterAll(async () => {
    if (fx) {
      await dropFixture(pool, fx);
    }
    if (pool) {
      await pool.end();
    }
  });

  it("offers a templateless gateway the map, then its active mapped key, and not its inactive one", async () => {
    await assertTheActiveMappedKeyIsOffered(fleetDb, fx);
  });

  it("gives another asset with no mapped point exactly the map", async () => {
    await assertAnotherAssetGetsOnlyTheMap(fleetDb, fx);
  });

  it("accepts the active mapped key", async () => {
    await assertTheActiveMappedKeyIsAccepted(fleetDb, fx);
  });

  it("refuses the inactive mapped key with the route's sentence", async () => {
    await assertTheInactiveMappedKeyIsRefused(fleetDb, fx);
  });

  it("still accepts a map key on the same gateway", async () => {
    await assertAMapKeyIsStillAccepted(fleetDb, fx);
  });
});
