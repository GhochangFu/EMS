import { randomUUID } from "node:crypto";

import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AccessControlService } from "./access-control.service";
import {
  assertAMoveReChecks,
  assertAssetGroupScopeHidesAnUnreadableParent,
  assertChainsListEachNodeThenItsAncestorsNearestFirst,
  assertCrossOrgEdgeFailsOnTheCompositeFk,
  assertEmptyChainsRunNoQuery,
  assertExactClosureForAGrantedNode,
  assertForeignOrganizationAdminIsNotOrganizationLevel,
  assertPerStepPredicateHoldsWithoutTheFk,
  assertReadSideMatchesManageSide,
  assertSiblingSubtreeAndParentAreRefused,
  assertTriggerRefusalsWithoutTheService,
  buildTreeFixture,
  seededPair,
  type TreeFixture,
} from "./location-tree.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";

/**
 * `F2.10` — Vitest entry point for the exact-closure tripwire. Assertions live
 * in the sibling `.spec` (§4.6); this file owns the connections and the one
 * transaction the fixture lives in.
 *
 * `DATABASE_URL` is read as the **superuser** (the gate's `connection:
 * "superuser"`): the fixture needs `session_replication_role = replica`
 * to plant an edge the composite foreign key forbids. The pool has `max: 1`, so
 * `BEGIN` on `pool.query` opens a transaction that every later `pool.query` —
 * the service's included — runs inside, and `afterAll` rolls it back. The
 * `bms_tenant` and `bms_fleet` pools serve assertions 4 and 5, whose claim is
 * that the database refuses with no privileged role in front of it.
 */

const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "location-tree closure tripwire",
  because:
    "a green run here would assert that a location grant means exactly its subtree — on the " +
    "manage side, the read side and the report-file scope — while nothing checked it. ADR 0018 " +
    "named this the widening that will not announce itself; fix the pipeline, do not relax this guard.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F2.10 — a location grant is exactly its subtree", () => {
  const run = randomUUID().slice(0, 8);
  let superPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let superDb: BmsDb;
  let tenantDb: BmsDb;
  let fleetDb: BmsDb;
  let svc: AccessControlService;
  let fx: TreeFixture;
  let seeded: Awaited<ReturnType<typeof seededPair>>;

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(url, "F2.10", { max: 1 });
    tenantPool = await openIntegrationPool(asRole(url, "bms_tenant", "bms_tenant_dev"), "F2.10");
    fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F2.10");
    superDb = createDb(superPool);
    tenantDb = createDb(tenantPool);
    fleetDb = createDb(fleetPool);
    svc = new AccessControlService(superDb, superDb);
    seeded = await seededPair(superPool);
    await superPool.query("BEGIN");
    await superPool.query("SET LOCAL lock_timeout = '10s'");
    fx = await buildTreeFixture(superPool, run);
  });

  afterAll(async () => {
    await superPool?.query("ROLLBACK").catch(() => undefined);
    await Promise.all([superPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("1. writableLocationIds(grantee) is exactly {A, A1, A1a}; canManageLocation agrees for each of the eight nodes", async () => {
    await assertExactClosureForAGrantedNode(svc, fx);
  });

  it("2. the sibling subtree B, B1 and the parent R are refused", async () => {
    await assertSiblingSubtreeAndParentAreRefused(svc, fx);
  });

  it("3. /auth/me's scope and readableAssetIds match the manage side; R is hidden from A.parentId", async () => {
    await assertReadSideMatchesManageSide(svc, fx);
  });

  it("3b. an asset_group_admin on A1 sees [A1] with parentId null", async () => {
    await assertAssetGroupScopeHidesAnUnreadableParent(svc, fx);
  });

  it("4. a cross-organization edge fails on the composite foreign key as bms_tenant and as bms_fleet, INSERT and UPDATE", async () => {
    await assertCrossOrgEdgeFailsOnTheCompositeFk({ tenantDb, fleetDb }, seeded, run);
  });

  it("5. the trigger refuses a cycle, depth 9 and decision 5 as bms_fleet with no GUC; REPEATABLE READ admits a root and refuses a child", async () => {
    await assertTriggerRefusalsWithoutTheService(fleetDb, fleetPool as pg.Pool, run);
  });

  it("6. with the foreign key off, a planted cross-organization edge reaches no surface (the ancestor chains included), and a planted cycle stays bounded", async () => {
    await assertPerStepPredicateHoldsWithoutTheFk(svc, superPool as pg.Pool, superDb, fx);
  });

  it("7. a move of A1 under B re-checks: grantee loses A1 and A1a, grantee2 gains them, the read side agrees", async () => {
    await assertAMoveReChecks(svc, superPool as pg.Pool, fx);
  });

  it("8. an organization_admin with a direct row on F210-B is organization-level for B and not for A", async () => {
    await assertForeignOrganizationAdminIsNotOrganizationLevel(svc, fx);
  });

  it("9. locationAncestorChains lists each node at steps 0, then its ancestors nearest-first", async () => {
    await assertChainsListEachNodeThenItsAncestorsNearestFirst(superDb, fx);
  });

  it("10. locationAncestorChains([]) returns [] without a query", async () => {
    await assertEmptyChainsRunNoQuery();
  });
});
