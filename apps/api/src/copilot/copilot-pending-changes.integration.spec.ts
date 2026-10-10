import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";
import { withUser } from "../database/user-context";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";

/**
 * `F3.85` PR 4 / ADR 0099 decision 4.5 — `CopilotPendingChangesService`
 * against migration `0105` on a real database, as `bms_tenant`: the atomic
 * claim, the per-user boundary, expiry, release, record and the sweep (plan
 * Q4). Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */
export type PendingCtx = {
  tenantDb: BmsDb;
  /** `bms_owner` — bound by the policy only through FORCE. */
  ownerPool: pg.Pool;
  orgA: string;
  userA: string;
  userB: string;
};

const service = (ctx: PendingCtx) => new CopilotPendingChangesService(ctx.tenantDb);

async function insertPending(
  ctx: PendingCtx,
  options: { expiresIn?: string; status?: string; claimedAgo?: string } = {},
): Promise<string> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_pending_changes
        (user_id, organization_id, catalog_id, method, path, body, body_hash, summary, risk, status, expires_at, claimed_at)
      VALUES (${ctx.userA}, ${ctx.orgA}, 'dashboards.create', 'POST', '/api/v1/dashboards', '{}'::jsonb,
              repeat('a', 64), 'F3.85 pending probe', 'create', ${options.status ?? "pending"},
              now() + ${options.expiresIn ?? "1 hour"}::interval,
              CASE WHEN ${options.claimedAgo ?? null}::text IS NULL THEN NULL
                   ELSE now() - ${options.claimedAgo ?? "0 seconds"}::interval END)
      RETURNING id`),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("F3.85: pending change was not created");
  return id;
}

async function statusOf(ctx: PendingCtx, id: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<Record<string, unknown>>(sql`
      SELECT status, claimed_at IS NOT NULL AS claimed, finished_at IS NOT NULL AS finished, result_status, resource_id
        FROM bms.copilot_pending_changes WHERE id = ${id}`),
  );
  return rows[0];
}

/** Ten concurrent claims of one row: exactly one wins. */
export async function concurrentClaimsApplyOnce(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx);
  const results = await Promise.all(Array.from({ length: 10 }, () => service(ctx).claim(ctx.userA, id)));
  const winners = results.filter((r) => r !== null);
  expect(winners).toHaveLength(1);
  expect(winners[0]).toEqual({
    method: "POST",
    path: "/api/v1/dashboards",
    bodyHash: "a".repeat(64),
    organizationId: ctx.orgA,
    catalogId: "dashboards.create",
  });
  expect(await statusOf(ctx, id)).toMatchObject({ status: "applying", claimed: true });
}

/** User B can neither read nor claim A's change; A can (positive control). */
export async function anotherUserCannotPeekOrClaim(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx);
  expect(await service(ctx).peek(ctx.userB, id)).toBeNull();
  expect(await service(ctx).claim(ctx.userB, id)).toBeNull();
  expect(await statusOf(ctx, id)).toMatchObject({ status: "pending", claimed: false });
  expect(await service(ctx).peek(ctx.userA, id)).toEqual({ organizationId: ctx.orgA });
}

export async function anExpiredChangeCannotBePeekedOrClaimed(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx, { expiresIn: "-1 minute" });
  expect(await service(ctx).peek(ctx.userA, id)).toBeNull();
  expect(await service(ctx).claim(ctx.userA, id)).toBeNull();
  expect(await statusOf(ctx, id)).toMatchObject({ status: "pending" });
}

/** A released claim is pending and claimable again. */
export async function releaseReturnsAClaimToPending(ctx: PendingCtx): Promise<void> {
  const id = await insertPending(ctx);
  expect(await service(ctx).claim(ctx.userA, id)).not.toBeNull();
  await service(ctx).release(ctx.userA, id);
  expect(await statusOf(ctx, id)).toMatchObject({ status: "pending", claimed: false });
  expect(await service(ctx).claim(ctx.userA, id)).not.toBeNull();
}

/** `record` moves only an `applying` row; a pending row is left exactly as it was. */
export async function recordMovesOnlyAnApplyingRow(ctx: PendingCtx): Promise<void> {
  const untouched = await insertPending(ctx);
  await service(ctx).record(ctx.userA, untouched, "applied", 201, "x");
  expect(await statusOf(ctx, untouched)).toEqual({
    status: "pending",
    claimed: false,
    finished: false,
    result_status: null,
    resource_id: null,
  });

  const id = await insertPending(ctx);
  await service(ctx).claim(ctx.userA, id);
  await service(ctx).record(ctx.userA, id, "applied", 201, "dash-1");
  expect(await statusOf(ctx, id)).toEqual({
    status: "applied",
    claimed: true,
    finished: true,
    result_status: 201,
    resource_id: "dash-1",
  });
}

/**
 * The sweep (plan Q4): a claim older than five minutes becomes `applied` when
 * the audit log holds a row carrying its id, else `failed`; a fresh claim is
 * left alone.
 */
export async function theSweepResolvesStuckClaimsFromTheAuditLog(ctx: PendingCtx): Promise<void> {
  const audited = await insertPending(ctx, { status: "applying", claimedAgo: "10 minutes" });
  const lost = await insertPending(ctx, { status: "applying", claimedAgo: "10 minutes" });
  const fresh = await insertPending(ctx, { status: "applying", claimedAgo: "1 minute" });
  await withTenant(ctx.tenantDb, ctx.orgA, (tx) =>
    tx.execute(sql`
      INSERT INTO bms.audit_log (organization_id, action, entity_type, payload)
      VALUES (${ctx.orgA}, 'dashboard.create', 'dashboard',
              jsonb_build_object('via', 'copilot', 'changeId', ${audited}::text))`),
  );

  const resolved = await service(ctx).sweepStuck(ctx.userA);
  expect(resolved).toBeGreaterThanOrEqual(2);
  expect(await statusOf(ctx, audited)).toMatchObject({ status: "applied", finished: true });
  expect(await statusOf(ctx, lost)).toMatchObject({ status: "failed", finished: true });
  expect(await statusOf(ctx, fresh)).toMatchObject({ status: "applying", finished: false });
  // Another user's sweep touches none of A's rows.
  await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute(sql`UPDATE bms.copilot_pending_changes SET claimed_at = now() - interval '10 minutes' WHERE id = ${fresh}`),
  );
  expect(await service(ctx).sweepStuck(ctx.userB)).toBe(0);
  expect(await statusOf(ctx, fresh)).toMatchObject({ status: "applying" });
}

/**
 * The owner is bound by FORCE on the message and pending-change tables too:
 * without a user it reads none of A's committed rows, with A's id it does
 * (`bms-owner-rls.integration.spec.ts` names this spec for that half).
 */
export async function theOwnerIsBoundOnMessagesAndPendingChanges(ctx: PendingCtx): Promise<void> {
  const pending = await insertPending(ctx);
  const conversation = await withUser(ctx.tenantDb, ctx.userA, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_conversations (user_id, title) VALUES (${ctx.userA}, 'F3.85 owner probe') RETURNING id`);
    const id = rows[0]?.id as string;
    await tx.execute(sql`
      INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content) VALUES (${id}, ${ctx.userA}, 'user', 'probe')`);
    return id;
  });
  const count = async (setUser: boolean) => {
    const client = await ctx.ownerPool.connect();
    try {
      await client.query("BEGIN");
      if (setUser) await client.query("SELECT set_config('app.current_user', $1, true)", [ctx.userA]);
      const { rows } = await client.query<{ messages: number; pending: number }>(
        `SELECT (SELECT count(*)::int FROM bms.copilot_messages WHERE conversation_id = $1) AS messages,
                (SELECT count(*)::int FROM bms.copilot_pending_changes WHERE id = $2) AS pending`,
        [conversation, pending],
      );
      await client.query("COMMIT");
      return rows[0];
    } finally {
      client.release();
    }
  };
  expect(await count(false)).toEqual({ messages: 0, pending: 0 });
  expect(await count(true)).toEqual({ messages: 1, pending: 1 });
}
