import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { LocationsAdminService } from "./locations.service";
import {
  assertDeactivateLocksBeforeItCounts,
  assertDecisionFive,
  assertEveryRefusalBodyIsInTheEnum,
  assertForeignOrganizationAdminCannotMove,
  assertListHidesTheUnreadableParent,
  assertLocationAdminCannotMove,
  assertLocationAdminCreatesNothing,
  assertLocationAdminWorksInsideItsClosure,
  assertOrgAdminCreatesAChild,
  assertOrgAdminMovesAndAudits,
  assertPlacementRefusals,
  buildFixture,
  dropFixture,
  type TreeCtx,
} from "./locations.tree.integration.spec";

/**
 * `F2.10` Unit D — Vitest entry point. Assertions live in the sibling `.spec`
 * (§4.6); this file owns the pools and the two per-run organizations, which
 * it deletes in `afterAll`. The service runs on the real `bms_auth`,
 * `bms_tenant` and `bms_fleet` roles, as `locations.rls.integration.test.ts`
 * constructs it; the superuser pool writes the fixture (users and grants are
 * invisible to `bms_owner` under FORCE ROW LEVEL SECURITY) and holds the row
 * lock in T6b.
 */
const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "LocationsAdminService over a location tree",
  because:
    "this suite is the only proof that a location admin cannot move a node, that a foreign " +
    "organization admin is refused with the move sentence, that decision 5 holds through the " +
    "service and that deactivate locks its row before it counts (ADR 0098 Amendment 1, A5).",
  connection: "owner",
});

describe.skipIf(!connectionString)("F2.10 — the locations admin write path over a tree", () => {
  const run = randomUUID().slice(0, 8);
  const pools: pg.Pool[] = [];
  let ctx: TreeCtx | undefined;
  let superPool: pg.Pool | undefined;

  const use = (): TreeCtx => {
    if (!ctx) throw new Error("F2.10 Unit D: the fixture was not built");
    return ctx;
  };

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F2.10");
    pools.push(superPool);
    const authPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "auth", process.env), "F2.10");
    pools.push(authPool);
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.10",
    );
    pools.push(tenantPool);
    const fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F2.10");
    pools.push(fleetPool);

    const svc = new LocationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), createDb(fleetPool)),
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
      new VocabulariesService(createDb(tenantPool)),
    );
    const fx = await buildFixture(superPool, run);
    ctx = { svc, superPool, fleetPool, fx };
  });

  afterAll(async () => {
    try {
      if (superPool) await dropFixture(superPool, run);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("T1 an organization admin creates a child; the audit carries parentId", async () => {
    await assertOrgAdminCreatesAChild(use());
  });
  it("T2 a location admin creates neither a root nor a child", async () => {
    await assertLocationAdminCreatesNothing(use());
  });
  it("T3 a location admin is refused a move: the move sentence in scope, the scope sentence outside it", async () => {
    await assertLocationAdminCannotMove(use());
  });
  it("T3b a foreign organization admin hears the scope sentence for a real node and an unknown id", async () => {
    await assertForeignOrganizationAdminCannotMove(use());
  });
  it("T4 an organization admin moves a node; master.location.move names both parents", async () => {
    await assertOrgAdminMovesAndAudits(use());
  });
  it("T5 move to root, not found (unknown and foreign), cycle, depth admitted at 8 and refused at 9 on create and move", async () => {
    await assertPlacementRefusals(use());
  });
  it("T6 decision 5 through the service", async () => {
    await assertDecisionFive(use());
  });
  it("T6b deactivate locks its row before it counts (A5)", async () => {
    await assertDeactivateLocksBeforeItCounts(use());
  });
  it("T7 a location admin works inside its closure; the granted node's parent is hidden", async () => {
    await assertLocationAdminWorksInsideItsClosure(use());
  });
  it("T8 the admin list hides an unreadable parent", async () => {
    await assertListHidesTheUnreadableParent(use());
  });
  it("T9 every refusal body is { message, reason } in the enum", async () => {
    await assertEveryRefusalBodyIsInTheEnum(use());
  });
});
