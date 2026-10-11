import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aBodyNamingAnotherOrganizationNeverCountsIt,
  aScopedAdminsMessagesAreInvisibleToAnotherUser,
  aTurnOnAnotherUsersConversationIs404,
  aTurnsMessagesHaveDistinctIncreasingCreatedAt,
  fleetIsRefusedTheMessages,
  type HistoryCtx,
  recentMessagesAreTheLast20OldestFirst,
  theGlobalAdminsMessagesAreInvisibleToOtherUsers,
} from "./copilot-history.rls.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot turn's stored messages",
  because:
    "a copilot message is its writer's alone (ADR 0099 decision 8), the global admin's included; only a real " +
    "database can show the user_isolation policy, the bms_fleet revoke and clock_timestamp() ordering.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot history fixture users",
  because: "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-HIST-${Date.now()}`;
const FAMILY_PATTERN = "F385-HIST-%";

describe.skipIf(!connectionString)("F3.85 PR 7 — the copilot turn's messages under RLS (migration 0105)", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: HistoryCtx;
  let orgId: string | undefined;
  let orgYId: string | undefined;

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
    // A run killed before afterAll leaves its fixtures. The global admin has no organization, so users go
    // by their email family; conversations and messages go with their user (ON DELETE CASCADE).
    await superPool.query("DELETE FROM bms.users WHERE email LIKE $1 AND created_at < now() - interval '30 minutes'", [
      FAMILY_PATTERN.toLowerCase(),
    ]);
    await superPool.query(
      "DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'",
      [FAMILY_PATTERN],
    );
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 history', 'INR') RETURNING id",
      [FAMILY],
    );
    orgId = org.rows[0]?.id;
    if (!orgId) throw new Error("F3.85: fixture organization was not created");
    const other = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 history Y', 'INR') RETURNING id",
      [`${FAMILY}-Y`],
    );
    orgYId = other.rows[0]?.id;
    if (!orgYId) throw new Error("F3.85: fixture organization Y was not created");
    const user = async (suffix: string, organizationId: string | null, role: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id",
        [organizationId, `${FAMILY.toLowerCase()}-${suffix}@example.test`, `F3.85 ${suffix}`, role],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture user ${suffix} was not created`);
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      fleetPool,
      superPool,
      orgA: orgId,
      orgY: orgYId,
      userA: await user("a", orgId, "organization_admin"),
      userB: await user("b", orgId, "organization_admin"),
      globalAdmin: await user("global", null, "admin"),
    };
  });

  afterAll(async () => {
    await superPool?.query("DELETE FROM bms.users WHERE email LIKE $1", [`${FAMILY.toLowerCase()}-%`]);
    for (const id of [orgId, orgYId]) {
      if (!id) continue;
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = $1", [id]);
      // The organization counters go with their organization (ON DELETE CASCADE).
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [id]);
    }
    await Promise.all([tenantPool?.end(), fleetPool?.end(), superPool?.end()]);
  });

  it("a scoped admin's messages are invisible to another user", async () => {
    await aScopedAdminsMessagesAreInvisibleToAnotherUser(ctx);
  });
  it("the global admin's messages are invisible to other users", async () => {
    await theGlobalAdminsMessagesAreInvisibleToOtherUsers(ctx);
  });
  it("bms_fleet is refused the messages with 42501", async () => {
    await fleetIsRefusedTheMessages(ctx);
  });
  it("a turn's messages get distinct, increasing created_at", async () => {
    await aTurnsMessagesHaveDistinctIncreasingCreatedAt(ctx);
  });
  it("a turn on another user's conversation is a 404; the owner's answers", async () => {
    await aTurnOnAnotherUsersConversationIs404(ctx);
  });
  it("history is the last 20 messages, oldest first", async () => {
    await recentMessagesAreTheLast20OldestFirst(ctx);
  });
  it("a body naming another organization is a 400 and never counts it", async () => {
    await aBodyNamingAnotherOrganizationNeverCountsIt(ctx);
  });
});
