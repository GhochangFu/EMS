import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  anotherUsersConversationIs404,
  type ConversationsCtx,
  createRecordsTheBinding,
  listIsNewestFirstAndMessagesAreOrdered,
} from "./copilot-conversations.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot conversation routes",
  because:
    "a conversation is one user's alone (ADR 0099 decision 8); only a real database can show that the " +
    "user_isolation policy turns another user's id into a 404.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the conversation fixture users",
  because: "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-CONV-${Date.now()}`;
const FAMILY_PATTERN = "F385-CONV-%";

describe.skipIf(!connectionString)("F3.85 — the copilot conversation routes (migration 0105)", () => {
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: ConversationsCtx;
  let orgId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    const stale = `SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`;
    await superPool.query(`DELETE FROM bms.audit_log WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.users WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.organizations WHERE id IN (${stale})`, [FAMILY_PATTERN]);
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 conversations', 'INR') RETURNING id",
      [FAMILY],
    );
    orgId = org.rows[0]?.id;
    if (!orgId) throw new Error("F3.85: fixture organization was not created");
    const user = async (suffix: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, 'organization_admin') RETURNING id",
        [orgId, `${FAMILY.toLowerCase()}-${suffix}@example.test`, `F3.85 ${suffix}`],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture user ${suffix} was not created`);
      return id;
    };
    ctx = { tenantDb: createDb(tenantPool), orgA: orgId, userA: await user("a"), userB: await user("b") };
  });

  afterAll(async () => {
    if (orgId) {
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [orgId]);
    }
    await Promise.all([tenantPool?.end(), superPool?.end()]);
  });

  it("createRecordsTheBinding", async () => {
    await createRecordsTheBinding(ctx);
  });
  it("anotherUsersConversationIs404", async () => {
    await anotherUsersConversationIs404(ctx);
  });
  it("listIsNewestFirstAndMessagesAreOrdered", async () => {
    await listIsNewestFirstAndMessagesAreOrdered(ctx);
  });
});
