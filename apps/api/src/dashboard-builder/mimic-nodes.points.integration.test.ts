import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertFanOutListedUnitAnswersTheListOnEveryMember,
  assertKeyTheAssetDoesNotHoldReadsItsNameAndNoSample,
  assertListedLayoutIsStillFiveStatements,
  assertListedUnitAnswersItsListInOrder,
  assertPresetBesideAListedLayoutAnswersTheHeadline,
  assertTwoUnitsOnOneAssetAnswerTheirOwnPoints,
} from "./mimic-nodes.points.integration.spec";

/**
 * `F4.307` (plan T6) — Vitest entry point for a layout unit's listed points against a real
 * database. Assertions live in the sibling `.spec` (ADR 0014); this file owns the pool. Every case
 * runs on the fleet pool (production's `FLEET_POOL`, ADR 0043) inside a transaction that is rolled
 * back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.307",
  label: "the mimic-nodes listed-points read",
  because:
    "the listed-key arm of the points statement, its asset-point join with the held gate on the latest-value " +
    "lateral, and the per-asset pair set are all SQL, so a green run without a database asserts nothing about " +
    "any of them.",
});

describe.skipIf(!connectionString)("F4.307 — MimicNodesService listed points", () => {
  let fleetPool: pg.Pool;

  beforeAll(async () => {
    fleetPool = await openIntegrationPool(connectionString as string, "F4.307");
  }, 60_000);

  afterAll(async () => {
    await fleetPool?.end();
  }, 60_000);

  const rolledBack = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(fleetPool, fn);

  it("R1 a listed unit answers its list in list order, not the headline order", rolledBack(assertListedUnitAnswersItsListInOrder), 60_000);
  it(
    "R2 an inactive asset point and a catalog-only key answer the catalog name and latest: null",
    rolledBack(assertKeyTheAssetDoesNotHoldReadsItsNameAndNoSample),
    60_000,
  );
  it(
    "R3 two units on one asset, one listed and one not, answer different points from one read",
    rolledBack(assertTwoUnitsOnOneAssetAnswerTheirOwnPoints),
    60_000,
  );
  it(
    "R4 a fan-out listed unit answers the list on asset and every member",
    rolledBack(assertFanOutListedUnitAnswersTheListOnEveryMember),
    60_000,
  );
  it("R5 a layout of listed units is still five statements", rolledBack(assertListedLayoutIsStillFiveStatements), 60_000);
  it(
    "R6 a preset beside a listed layout answers the headline points unchanged",
    rolledBack(assertPresetBesideAListedLayoutAnswersTheHeadline),
    60_000,
  );
});
