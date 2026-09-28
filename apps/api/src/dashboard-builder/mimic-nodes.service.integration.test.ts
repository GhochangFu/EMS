import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAllEightNodesInPresetOrder,
  assertBadConfigWidgetIsSkipped,
  assertEightDayOldSampleIsNull,
  assertForeignOrganizationIsNotFound,
  assertFullReadIsThreeStatements,
  assertGrouplessDashboardIsEightNullsInOneStatement,
  assertNoMimicIsEmptyInOneStatement,
  assertOwningOrganizationReads,
  assertReadableRoIsStillShown,
  assertRoCountsTwoMembers,
  assertRoShowsTheFirstCode,
  assertSixDayOldSampleIsPresent,
  assertSixUnassignedNodesAreNull,
  assertUnreadableWtpIsUnassigned,
  assertWtpCountsOneOpenAlarm,
  assertWtpShowsTopThreeInRankOrder,
} from "./mimic-nodes.service.integration.spec";

/**
 * `F3.32` — Vitest entry point for `MimicNodesService` against a real database (plan U2).
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the pool. Every case runs
 * on the fleet pool (production's `FLEET_POOL`, ADR 0043) inside a transaction that is rolled
 * back, so nothing commits.
 */
const connectionString = requireIntegrationDb({
  item: "F3.32",
  label: "the mimic-nodes read",
  because:
    "the role resolution, the first-by-code pick, the readable-asset narrowing, the per-asset top-three " +
    "LIMIT, the 7-day-bounded latest-sample LATERAL and the open-alarm count are all SQL, so a green run " +
    "without a database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.32 — MimicNodesService", () => {
  let fleetPool: pg.Pool;

  beforeAll(async () => {
    fleetPool = await openIntegrationPool(connectionString as string, "F3.32");
  }, 60_000);

  afterAll(async () => {
    await fleetPool?.end();
  }, 60_000);

  const rolledBack = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(fleetPool, fn);

  it("M1 the wtp node counts its one open alarm, not the cleared one", rolledBack(assertWtpCountsOneOpenAlarm), 60_000);
  it(
    "M2 the wtp node shows three of four points, rank ASC NULLS LAST then key",
    rolledBack(assertWtpShowsTopThreeInRankOrder),
    60_000,
  );
  it("M3a a point sampled only 8 days ago answers latest: null", rolledBack(assertEightDayOldSampleIsNull), 60_000);
  it("M3b a point sampled 6 days ago answers its value", rolledBack(assertSixDayOldSampleIsPresent), 60_000);
  it("M4a two ro members answer memberCount 2", rolledBack(assertRoCountsTwoMembers), 60_000);
  it("M4b the ro node shows the member with the first code", rolledBack(assertRoShowsTheFirstCode), 60_000);
  it("M5a all eight nodes are answered in preset order", rolledBack(assertAllEightNodesInPresetOrder), 60_000);
  it("M5b the six roles no member carries answer null", rolledBack(assertSixUnassignedNodesAreNull), 60_000);
  it("M6a an unreadable wtp member reads Not assigned", rolledBack(assertUnreadableWtpIsUnassigned), 60_000);
  it("M6b the readable ro member is still shown", rolledBack(assertReadableRoIsStillShown), 60_000);
  it("M7 the full read is three statements", rolledBack(assertFullReadIsThreeStatements), 60_000);
  it(
    "M8 a group-less dashboard answers eight null nodes in one statement",
    rolledBack(assertGrouplessDashboardIsEightNullsInOneStatement),
    60_000,
  );
  it("M9 no mimic widget answers widgets: [] in one statement", rolledBack(assertNoMimicIsEmptyInOneStatement), 60_000);
  it("M10 a widget whose stored config fails the schema is skipped", rolledBack(assertBadConfigWidgetIsSkipped), 60_000);
  it("M11a a foreign organization gets 404", rolledBack(assertForeignOrganizationIsNotFound), 60_000);
  it("M11b the owning organization reads the widget", rolledBack(assertOwningOrganizationReads), 60_000);
});
