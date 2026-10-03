import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import {
  assertAdminCreateInsertLandsOnTheFleetRole,
  assertCreateInsertLandsOnTheTenantRole,
  assertDeactivateUnderTheWrongGucIsRefusedWithNoAudit,
  assertDeactivatingAnAdminWaitsOnTheLastAdminLock,
  assertDemotingAnAdminWaitsOnTheLastAdminLock,
  assertDemotionFromAdminRunsOnTheFleetRole,
  assertNoCommittedFixtureLeaked,
  assertPromotionToAdminRunsOnTheFleetRole,
} from "./users.integration.spec";

/**
 * `F3.78` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the superuser and `bms_fleet` pools.
 */
const connectionString = requireIntegrationDb({
  item: "F3.78",
  label: "the users API's statements on the real pool roles",
  because:
    "whether a user insert lands depends on 0098's column INSERT grant (password_hash absent) and on " +
    "0048's strict WITH CHECK, and the last-admin rule depends on FOR UPDATE blocking a second " +
    "connection. A fake db proves none of the three.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F3.78 — users API on the real pool roles (ADR 0089)", { timeout: 60_000 }, () => {
  let superPool: pg.Pool;
  let superDb: BmsDb;
  let fleetPool: pg.Pool;

  beforeAll(async () => {
    superPool = await openIntegrationPool(connectionString as string, "F3.78");
    superDb = createDb(superPool);
    fleetPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(connectionString as string, "fleet", process.env),
      "F3.78",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await fleetPool?.end();
    await superPool?.end();
  });

  it("UsersService.create's raw insert of a viewer lands under withTenant on bms_tenant", async () => {
    await assertCreateInsertLandsOnTheTenantRole(superDb);
  });

  it("UsersService.create of an admin lands on bms_fleet with organization_id NULL", async () => {
    await assertAdminCreateInsertLandsOnTheFleetRole(superDb);
  });

  it("a promotion to admin through the service runs on bms_fleet and lands", async () => {
    await assertPromotionToAdminRunsOnTheFleetRole(superDb);
  });

  it("a demotion from admin through the service runs on bms_fleet and lands", async () => {
    await assertDemotionFromAdminRunsOnTheFleetRole(superDb);
  });

  it("deactivate under another organization's GUC updates zero rows and is refused with no audit row", async () => {
    await assertDeactivateUnderTheWrongGucIsRefusedWithNoAudit(superDb);
  });

  it("demoting an admin while another admin row is locked fails with 55P03 (the last-admin lock)", async () => {
    await assertDemotingAnAdminWaitsOnTheLastAdminLock({ superPool, fleetPool });
  });

  it("deactivating an admin while another admin row is locked fails with 55P03 (the last-admin lock)", async () => {
    await assertDeactivatingAnAdminWaitsOnTheLastAdminLock({ superPool, fleetPool });
  });

  it("leaves no committed f3.78-pr2 fixture user behind", async () => {
    await assertNoCommittedFixtureLeaked(superPool);
  });
});
