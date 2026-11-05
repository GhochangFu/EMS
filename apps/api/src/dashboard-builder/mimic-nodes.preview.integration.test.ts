import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertPreviewFanOutListsMembers,
  assertPreviewListAnswersInOrder,
  assertPreviewOfAnotherOrganizationsLayoutIsEmpty,
  assertPreviewParsesWithTheLayoutIdInEveryId,
  assertPreviewReadableSetNarrowsMemberCount,
  assertPreviewReadsNoDashboardAndWritesNothing,
  assertPreviewResolvesRoledUnitsAgainstTheGroup,
  assertPreviewUnitWithNoMemberIsUnassigned,
  assertPreviewWithNoReadableAssetIsUnassigned,
} from "./mimic-nodes.preview.integration.spec";

/**
 * `F4.308` (plan T2) — Vitest entry point for the layout preview read against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the pool. Every case runs on
 * the fleet pool (production's `FLEET_POOL`, ADR 0043) inside a transaction that is rolled back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.308",
  label: "the mimic layout preview read",
  because:
    "the preview feeds the resolver's layout, members and points statements one synthetic widget, and every " +
    "one of those statements is SQL with an organization predicate, so a green run without a database asserts " +
    "nothing about any of them.",
});

describe.skipIf(!connectionString)("F4.308 — MimicNodesService.readLayoutPreview", () => {
  let fleetPool: pg.Pool;

  beforeAll(async () => {
    fleetPool = await openIntegrationPool(connectionString as string, "F4.308");
  }, 60_000);

  afterAll(async () => {
    await fleetPool?.end();
  }, 60_000);

  const rolledBack = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(fleetPool, fn);

  it(
    "V1 the answer parses the shared schema with the layout id in every id",
    rolledBack(assertPreviewParsesWithTheLayoutIdInEveryId),
    60_000,
  );
  it("V2 roled units resolve against the group", rolledBack(assertPreviewResolvesRoledUnitsAgainstTheGroup), 60_000);
  it("V3 a role with no member reads asset: null", rolledBack(assertPreviewUnitWithNoMemberIsUnassigned), 60_000);
  it("V4 a point list answers in order, latest: null for a lacking key", rolledBack(assertPreviewListAnswersInOrder), 60_000);
  it("V5 a fan-out unit lists its members", rolledBack(assertPreviewFanOutListsMembers), 60_000);
  it(
    "V6 no readable asset leaves every unit unassigned with no members statement",
    rolledBack(assertPreviewWithNoReadableAssetIsUnassigned),
    60_000,
  );
  it("V7 a readable set narrows memberCount", rolledBack(assertPreviewReadableSetNarrowsMemberCount), 60_000);
  it(
    "V8 the preview reads no dashboard table and writes nothing",
    rolledBack(assertPreviewReadsNoDashboardAndWritesNothing),
    60_000,
  );
  it(
    "V9 another organization's layout answers no widget",
    rolledBack(assertPreviewOfAnotherOrganizationsLayoutIsEmpty),
    60_000,
  );
});
