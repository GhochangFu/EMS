import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertActiveStatePointCarriesItsLatestValue,
  assertFanOutAlarmsAreSummedAndWorst,
  assertFanOutAnswersEveryMemberInCodeOrder,
  assertFanOutIsCappedAtSixteen,
  assertForeignStampedNamedTabIsUnassigned,
  assertKeyWithoutStateRowIsNotAStatePoint,
  assertLayoutFanOutUnitAnswersEveryMember,
  assertLayoutGeometryCarriesTheStoredFlags,
  assertLayoutUnitWithoutFanOutShowsOneMember,
  assertNonFanOutNodeHasNoMembers,
  assertOverviewMimicResolvesThroughTheNamedTab,
  assertOwnGroupTabWinsOverTheNamedTab,
  assertRolelessPresetNodeIsAbsent,
  assertScopedFanOutLeavesOutTheUnreadableMember,
  assertStateMapsListOnlyTheKeysSeen,
  assertStatePointCountsTowardFreshness,
  assertTabKeyOfAnotherDashboardIsUnassigned,
} from "./mimic-nodes.fanout.integration.spec";

/**
 * `F3.74` (Task 2.2) — Vitest entry point for the fan-out resolver against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the pool. Every case runs on
 * the fleet pool (production's `FLEET_POOL`, ADR 0043) inside a transaction that is rolled back.
 */
const connectionString = requireIntegrationDb({
  item: "F3.74",
  label: "the mimic-nodes fan-out read",
  because:
    "the per-role member window and its cap, the state-point join to bms.point_key_states, the state maps " +
    "read and the named-tab join with its organization predicate are all SQL, so a green run without a " +
    "database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.74 — MimicNodesService fan-out", () => {
  let fleetPool: pg.Pool;

  beforeAll(async () => {
    fleetPool = await openIntegrationPool(connectionString as string, "F3.74");
  }, 60_000);

  afterAll(async () => {
    await fleetPool?.end();
  }, 60_000);

  const rolledBack = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(fleetPool, fn);

  it("F1 a fan-out node answers every member in code order", rolledBack(assertFanOutAnswersEveryMemberInCodeOrder), 60_000);
  it("F2 seventeen members answer sixteen and memberCount 17", rolledBack(assertFanOutIsCappedAtSixteen), 60_000);
  it(
    "F3 an active state point carries its latest value; an inactive one is absent",
    rolledBack(assertActiveStatePointCarriesItsLatestValue),
    60_000,
  );
  it("F4 a key with no point_key_states row is not a state point", rolledBack(assertKeyWithoutStateRowIsNotAStatePoint), 60_000);
  it("F5 stateMaps lists only the keys seen", rolledBack(assertStateMapsListOnlyTheKeysSeen), 60_000);
  it("F6 a node without fanOut answers members: []", rolledBack(assertNonFanOutNodeHasNoMembers), 60_000);
  it("F7 a fan-out node sums alarms and answers the worst", rolledBack(assertFanOutAlarmsAreSummedAndWorst), 60_000);
  it(
    "F7b a scoped reader's fan-out leaves the unreadable member out of members, count and alarms",
    rolledBack(assertScopedFanOutLeavesOutTheUnreadableMember),
    60_000,
  );
  it("F8 a role-less preset node is absent from nodes", rolledBack(assertRolelessPresetNodeIsAbsent), 60_000);
  it(
    "F9 an Overview mimic naming sld resolves through that tab's group",
    rolledBack(assertOverviewMimicResolvesThroughTheNamedTab),
    60_000,
  );
  it(
    "F9b the mimic's own group tab wins over a named tab with its own group",
    rolledBack(assertOwnGroupTabWinsOverTheNamedTab),
    60_000,
  );
  it(
    "F10a a tabKey naming another dashboard's tab answers unassigned",
    rolledBack(assertTabKeyOfAnotherDashboardIsUnassigned),
    60_000,
  );
  it(
    "F10b a named tab stamped with another organization answers unassigned",
    rolledBack(assertForeignStampedNamedTabIsUnassigned),
    60_000,
  );
  it("F11 a state point's sample counts toward latestTelemetryAt", rolledBack(assertStatePointCountsTowardFreshness), 60_000);
  it("F12 a layout fan-out unit answers every member", rolledBack(assertLayoutFanOutUnitAnswersEveryMember), 60_000);
  it("F13 the layout geometry carries the stored flags", rolledBack(assertLayoutGeometryCarriesTheStoredFlags), 60_000);
  it(
    "F14 a layout unit without fan_out answers one member and memberCount 3",
    rolledBack(assertLayoutUnitWithoutFanOutShowsOneMember),
    60_000,
  );
});
