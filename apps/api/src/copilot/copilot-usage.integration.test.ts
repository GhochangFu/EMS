import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aKolkataMidnightSplitsTheOrganizationDayOnTheDatabase,
  anotherUserCannotSeeTheCounter,
  concurrentTurnsAt149ExactlyOnePasses,
  crossOrganizationTurnTouchesTheUserCounterOnlyOnTheDatabase,
  fleetHasNoPrivilegeOnEitherCounter,
  oneUserTwoOrganizationsShareTheUserLimitOnTheDatabase,
  organizationRefusalLeavesTheUserCounterUnchanged,
  turn150AllowedAnd151RefusedOnTheDatabase,
  type UsageCtx,
  userDayAndOrganizationDayDifferOnTheDatabase,
} from "./copilot-usage.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot daily turn counters",
  because:
    "a turn over the user's or the organization's daily limit must be refused and count nowhere (ADR 0099 decision 11, " +
    "Amendment 1 A1); only a real database can show that the upsert holds the limit under concurrency and that a " +
    "refusal rolls back.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the usage-counter fixture users",
  because: "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-USAGE-${Date.now()}`;
const FAMILY_PATTERN = "F385-USAGE-%";

describe.skipIf(!connectionString)("F3.85 — the copilot daily turn counters (migration 0106)", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: UsageCtx;
  const orgIds: string[] = [];
  let globalAdminId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.85",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    // A run killed before afterAll leaves its fixtures; the counters go with their user or organization (CASCADE).
    await superPool.query(
      "DELETE FROM bms.users WHERE email LIKE $1 AND created_at < now() - interval '30 minutes'",
      [`${FAMILY_PATTERN.toLowerCase()}`],
    );
    await superPool.query(
      "DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'",
      [FAMILY_PATTERN],
    );
    const org = async (suffix: string, timezone: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.organizations (code, name, currency, timezone) VALUES ($1, $2, 'INR', $3) RETURNING id",
        [`${FAMILY}-${suffix}`, `F3.85 usage ${suffix}`, timezone],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture organization ${suffix} was not created`);
      orgIds.push(id);
      return id;
    };
    const user = async (suffix: string, organizationId: string | null, role: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id",
        [organizationId, `${FAMILY.toLowerCase()}-${suffix}@example.test`, `F3.85 usage ${suffix}`, role],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture user ${suffix} was not created`);
      return id;
    };
    const orgK = await org("K", "Asia/Kolkata");
    const orgU = await org("U", "UTC");
    globalAdminId = await user("global", null, "admin");
    ctx = {
      tenantDb: createDb(tenantPool),
      fleetPool,
      orgK,
      orgU,
      userA: { id: await user("a", orgK, "organization_admin"), organizationId: orgK },
      userB: { id: await user("b", orgK, "organization_admin"), organizationId: orgK },
      globalAdmin: { id: globalAdminId, organizationId: null },
    };
  });

  afterAll(async () => {
    if (globalAdminId) {
      await superPool.query("DELETE FROM bms.users WHERE id = $1", [globalAdminId]);
    }
    for (const id of orgIds) {
      await superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [id]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [id]);
    }
    await Promise.all([tenantPool?.end(), fleetPool?.end(), superPool?.end()]);
  });

  it("turn150AllowedAnd151RefusedOnTheDatabase", async () => {
    await turn150AllowedAnd151RefusedOnTheDatabase(ctx);
  });
  it("concurrentTurnsAt149ExactlyOnePasses", async () => {
    await concurrentTurnsAt149ExactlyOnePasses(ctx);
  });
  it("organizationRefusalLeavesTheUserCounterUnchanged", async () => {
    await organizationRefusalLeavesTheUserCounterUnchanged(ctx);
  });
  it("oneUserTwoOrganizationsShareTheUserLimitOnTheDatabase", async () => {
    await oneUserTwoOrganizationsShareTheUserLimitOnTheDatabase(ctx);
  });
  it("crossOrganizationTurnTouchesTheUserCounterOnlyOnTheDatabase", async () => {
    await crossOrganizationTurnTouchesTheUserCounterOnlyOnTheDatabase(ctx);
  });
  it("aKolkataMidnightSplitsTheOrganizationDayOnTheDatabase", async () => {
    await aKolkataMidnightSplitsTheOrganizationDayOnTheDatabase(ctx);
  });
  it("userDayAndOrganizationDayDifferOnTheDatabase", async () => {
    await userDayAndOrganizationDayDifferOnTheDatabase(ctx);
  });
  it("anotherUserCannotSeeTheCounter", async () => {
    await anotherUserCannotSeeTheCounter(ctx);
  });
  it("fleetHasNoPrivilegeOnEitherCounter", async () => {
    await fleetHasNoPrivilegeOnEitherCounter(ctx);
  });
});
