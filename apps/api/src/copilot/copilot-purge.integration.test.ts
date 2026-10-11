import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  anOldPendingChangeInALiveConversationSurvives,
  type PurgeCtx,
  type PurgeFixture,
  runThePurge,
  seedCounterFixture,
  seedPurgeFixture,
  theAppliedChangeSurvivesWithANullConversation,
  theCountersAreSeeded,
  theOldOrgCounterIsGoneAndTheYoungOneStays,
  theOldUserCounterIsGoneAndTheYoungOneStays,
  theOldApplyingClaimIsFailedAndTheYoungOneStays,
  theOldConversationAndItsMessageAreGone,
  theOldOrphanPendingChangeIsGoneAndTheYoungOneStays,
  theOldOrphanRejectedChangeIsGone,
  theOwnerWithNoSettingDeletesNothing,
  theSecondUsersOldConversationIsGone,
  theYoungConversationAndItsMessageSurvive,
} from "./copilot-purge.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot history purge",
  because:
    "copilot history is kept for 30 days and no longer (ADR 0099 decision 8); only a real database can show " +
    "the cascade to messages, the SET NULL on pending changes and the per-user policy the purge runs under.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the purge fixture users",
  because:
    "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-PURGE-${Date.now()}`;
const FAMILY_PATTERN = "F385-PURGE-%";

describe.skipIf(!connectionString)("F3.85 — the copilot history purge (migrations 0105, 0106)", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: PurgeCtx;
  let fixture: PurgeFixture;
  let orgId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.85");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.85",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    // A run killed before afterAll leaves its organization; its users and their copilot rows go with it.
    const stale = `SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`;
    await superPool.query(`DELETE FROM bms.users WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.organizations WHERE id IN (${stale})`, [FAMILY_PATTERN]);
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 copilot purge', 'INR') RETURNING id",
      [FAMILY],
    );
    orgId = org.rows[0]?.id;
    if (!orgId) throw new Error("F3.85: fixture organization was not created");
    const user = async (suffix: string): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        "INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, 'organization_admin') RETURNING id",
        [orgId, `${FAMILY.toLowerCase()}-${suffix}@example.test`, `F3.85 purge ${suffix}`],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.85: fixture user ${suffix} was not created`);
      return id;
    };
    ctx = {
      tenantDb: createDb(tenantPool),
      fleetDb: createDb(fleetPool),
      ownerPool,
      superPool,
      orgA: orgId,
      userA: await user("a"),
      userB: await user("b"),
    };
    fixture = await seedPurgeFixture(ctx);
    await seedCounterFixture(ctx);
  });

  afterAll(async () => {
    if (orgId) {
      await superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [orgId]);
    }
    await Promise.all([ownerPool?.end(), tenantPool?.end(), fleetPool?.end(), superPool?.end()]);
  });

  it("the owner with no app.current_user deletes nothing (FORCE)", async () => {
    await theOwnerWithNoSettingDeletesNothing(ctx, fixture);
  });
  it("before the purge, the user and organization counters at 31, 30 and 29 days are there", async () => {
    await theCountersAreSeeded(ctx);
  });

  describe("after one purge", () => {
    beforeAll(async () => {
      await runThePurge(ctx);
    });

    it("the 31-day conversation and its message are gone (ON DELETE CASCADE)", async () => {
      await theOldConversationAndItsMessageAreGone(ctx, fixture);
    });
    it("the applied change in it survives with conversation_id null (SET NULL)", async () => {
      await theAppliedChangeSurvivesWithANullConversation(ctx, fixture);
    });
    it("the 29-day conversation and its message survive", async () => {
      await theYoungConversationAndItsMessageSurvive(ctx, fixture);
    });
    it("the 31-day orphan pending change is gone; the 29-day one stays", async () => {
      await theOldOrphanPendingChangeIsGoneAndTheYoungOneStays(ctx, fixture);
    });
    it("the 31-day orphan rejected change is gone", async () => {
      await theOldOrphanRejectedChangeIsGone(ctx, fixture);
    });
    it("a 31-day pending change in a live conversation survives", async () => {
      await anOldPendingChangeInALiveConversationSurvives(ctx, fixture);
    });
    it("the applying row claimed 31 days ago is failed; the 29-day one stays applying", async () => {
      await theOldApplyingClaimIsFailedAndTheYoungOneStays(ctx, fixture);
    });
    it("the second user's 31-day conversation is gone, in that user's own transaction", async () => {
      await theSecondUsersOldConversationIsGone(ctx, fixture);
    });
    it("the user's 31-day usage counter is gone; the 30- and 29-day ones stay (A1)", async () => {
      await theOldUserCounterIsGoneAndTheYoungOneStays(ctx);
    });
    it("the organization's 31-day usage counter is gone under withTenant; the 30- and 29-day ones stay (A1)", async () => {
      await theOldOrgCounterIsGoneAndTheYoungOneStays(ctx);
    });
  });
});
