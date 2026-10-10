import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aChildRowJoinsOnlyItsOwnUsersConversation,
  aUserCannotWriteAnotherUsersRow,
  aUserSeesOnlyItsOwnRows,
  theFleetRoleIsRefusedOnEveryTable,
  theOwnerIsBoundByTheUserPolicy,
  theSettingsDoNotOutliveTheTransaction,
  type UserContextCtx,
} from "./user-context.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "withUser and the copilot user_isolation policy",
  because:
    "a copilot conversation is one user's alone (ADR 0099 decision 8); only a real database can show " +
    "that the policy hides it from every other user, refuses a forged user_id, and that bms_fleet " +
    "is refused rather than filtered.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the withUser fixture users",
  because:
    "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-USERCTX-${Date.now()}`;
const FAMILY_PATTERN = "F385-USERCTX-%";

describe.skipIf(!connectionString)("F3.85 — withUser and the user_isolation policy (migration 0105)", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let superPool: pg.Pool;
  let singlePool: pg.Pool;
  let ctx: UserContextCtx;
  let orgId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.85");
    const tenantUrl = process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev");
    tenantPool = await openIntegrationPool(tenantUrl, "F3.85");
    singlePool = new pg.Pool({ connectionString: tenantUrl, max: 1 });
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    // A run killed before afterAll leaves its organization; users and their rows cascade with it.
    await superPool.query(
      `DELETE FROM bms.users WHERE organization_id IN (SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes')`,
      [FAMILY_PATTERN],
    );
    await superPool.query(
      `DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [FAMILY_PATTERN],
    );
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 user context', 'INR') RETURNING id",
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
    ctx = {
      tenantDb: createDb(tenantPool),
      tenantPool,
      fleetPool,
      ownerPool,
      orgA: orgId,
      userA: await user("a"),
      userB: await user("b"),
    };
  });

  afterAll(async () => {
    if (orgId) {
      await superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [orgId]);
    }
    await Promise.all([ownerPool?.end(), tenantPool?.end(), singlePool?.end(), fleetPool?.end(), superPool?.end()]);
  });

  it("aUserSeesOnlyItsOwnRows", async () => {
    await aUserSeesOnlyItsOwnRows(ctx);
  });
  it("aUserCannotWriteAnotherUsersRow", async () => {
    await aUserCannotWriteAnotherUsersRow(ctx);
  });
  it("theFleetRoleIsRefusedOnEveryTable", async () => {
    await theFleetRoleIsRefusedOnEveryTable(ctx);
  });
  it("theOwnerIsBoundByTheUserPolicy", async () => {
    await theOwnerIsBoundByTheUserPolicy(ctx);
  });
  it("aChildRowJoinsOnlyItsOwnUsersConversation", async () => {
    await aChildRowJoinsOnlyItsOwnUsersConversation(ctx);
  });
  it("theSettingsDoNotOutliveTheTransaction", async () => {
    await theSettingsDoNotOutliveTheTransaction(ctx, createDb(singlePool));
  });
});
