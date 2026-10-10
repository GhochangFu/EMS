import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  anExpiredChangeCannotBePeekedOrClaimed,
  anotherUserCannotPeekOrClaim,
  concurrentClaimsApplyOnce,
  type PendingCtx,
  recordMovesOnlyAnApplyingRow,
  releaseReturnsAClaimToPending,
  theOwnerIsBoundOnMessagesAndPendingChanges,
  theSweepResolvesStuckClaimsFromTheAuditLog,
} from "./copilot-pending-changes.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the copilot pending-change claim",
  because:
    "a confirmed copilot change must apply exactly once and only for its own user (ADR 0099 decision 4.5); " +
    "only a real database can show that concurrent claims serialise and that the policy confines each one.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.85",
  label: "the pending-change fixture users",
  because:
    "Only the superuser inserts and deletes a bms.users row under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F385-PENDING-${Date.now()}`;
const FAMILY_PATTERN = "F385-PENDING-%";

describe.skipIf(!connectionString)("F3.85 — the copilot pending-change claim (migration 0105)", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: PendingCtx;
  let orgId: string | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.85");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.85",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.85");
    // A run killed before afterAll leaves its organization; the audit rows, users and their rows go with it.
    const stale = `SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`;
    await superPool.query(`DELETE FROM bms.audit_log WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.users WHERE organization_id IN (${stale})`, [FAMILY_PATTERN]);
    await superPool.query(`DELETE FROM bms.organizations WHERE id IN (${stale})`, [FAMILY_PATTERN]);
    const org = await superPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.85 pending changes', 'INR') RETURNING id",
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
    ctx = { tenantDb: createDb(tenantPool), ownerPool, orgA: orgId, userA: await user("a"), userB: await user("b") };
  });

  afterAll(async () => {
    if (orgId) {
      await superPool.query("DELETE FROM bms.audit_log WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.users WHERE organization_id = $1", [orgId]);
      await superPool.query("DELETE FROM bms.organizations WHERE id = $1", [orgId]);
    }
    await Promise.all([ownerPool?.end(), tenantPool?.end(), superPool?.end()]);
  });

  it("concurrentClaimsApplyOnce", async () => {
    await concurrentClaimsApplyOnce(ctx);
  });
  it("anotherUserCannotPeekOrClaim", async () => {
    await anotherUserCannotPeekOrClaim(ctx);
  });
  it("anExpiredChangeCannotBePeekedOrClaimed", async () => {
    await anExpiredChangeCannotBePeekedOrClaimed(ctx);
  });
  it("releaseReturnsAClaimToPending", async () => {
    await releaseReturnsAClaimToPending(ctx);
  });
  it("recordMovesOnlyAnApplyingRow", async () => {
    await recordMovesOnlyAnApplyingRow(ctx);
  });
  it("theSweepResolvesStuckClaimsFromTheAuditLog", async () => {
    await theSweepResolvesStuckClaimsFromTheAuditLog(ctx);
  });
  it("theOwnerIsBoundOnMessagesAndPendingChanges", async () => {
    await theOwnerIsBoundOnMessagesAndPendingChanges(ctx);
  });
});
