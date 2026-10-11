import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withUser } from "../database/user-context";
import { CopilotPurgeService } from "./copilot-purge.service";

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — `CopilotPurgeService` against
 * migration `0105` on a real database: the users listed on `bms_fleet`, the
 * deletes run as `bms_tenant` inside `withUser`, the real `ON DELETE
 * CASCADE` to messages and the real `SET NULL` on pending changes, and the
 * owner bound by FORCE. Since PR 6, also the two `0106` usage counters:
 * the user's under `withUser`, the organization's under `withTenant`.
 * Vitest entry point: the sibling `.test.ts` (ADR
 * 0014).
 *
 * **The database is shared.** The purge walks every user, so every claim
 * here reads this suite's own rows by id and never the counts the service
 * returns. Rows are aged explicitly (`now() - interval '31 days'`).
 */
export type PurgeCtx = {
  tenantDb: BmsDb;
  fleetDb: BmsDb;
  /** `bms_owner` — bound by the policy only through FORCE. */
  ownerPool: pg.Pool;
  /** The superuser — inserts and reads the usage counters past both policies (PR 6). */
  superPool: pg.Pool;
  orgA: string;
  userA: string;
  userB: string;
};

export type PurgeFixture = {
  convOld: string;
  msgOld: string;
  appliedInOld: string;
  convYoung: string;
  msgYoung: string;
  orphanPendingOld: string;
  orphanPendingYoung: string;
  /** A 31-day orphan `rejected` change: the purge deletes it (the 'rejected' in the predicate). */
  orphanRejectedOld: string;
  /** A 31-day `pending` change still in a live (29-day) conversation: it survives (`conversation_id IS NULL`). */
  pendingInYoungOld: string;
  applyingOld: string;
  applyingYoung: string;
  convBOld: string;
};

/**
 * `F3.85` PR 6 / ADR 0099 Amendment 1 A1 — the usage counters, dated in UTC
 * days before today: user A's and organization A's at 31, 30 and 29 days —
 * 30 is the boundary, kept, because only a day before the cut-off date goes. Inserted as the superuser; the rows go with the fixture user and
 * organization (`ON DELETE CASCADE`).
 */
export async function seedCounterFixture(ctx: PurgeCtx): Promise<void> {
  const today = "(now() AT TIME ZONE 'UTC')::date";
  await ctx.superPool.query(
    `INSERT INTO bms.copilot_usage (user_id, day, turns) VALUES ($1, ${today} - 31, 1), ($1, ${today} - 30, 1), ($1, ${today} - 29, 1)`,
    [ctx.userA],
  );
  await ctx.superPool.query(
    `INSERT INTO bms.copilot_org_usage (organization_id, day, turns) VALUES ($1, ${today} - 31, 1), ($1, ${today} - 30, 1), ($1, ${today} - 29, 1)`,
    [ctx.orgA],
  );
}

/** Days before today (UTC) of the rows left, oldest first. */
async function counterAges(ctx: PurgeCtx, table: "copilot_usage" | "copilot_org_usage", column: string, id: string) {
  const { rows } = await ctx.superPool.query<{ age: number }>(
    `SELECT ((now() AT TIME ZONE 'UTC')::date - day) AS age FROM bms.${table} WHERE ${column} = $1 ORDER BY day`,
    [id],
  );
  return rows.map((r) => r.age);
}

/** Positive control, before the purge: both ages of both counters are there, so a later `[30, 29]` is the purge. */
export async function theCountersAreSeeded(ctx: PurgeCtx): Promise<void> {
  expect({
    user: await counterAges(ctx, "copilot_usage", "user_id", ctx.userA),
    org: await counterAges(ctx, "copilot_org_usage", "organization_id", ctx.orgA),
  }).toEqual({ user: [31, 30, 29], org: [31, 30, 29] });
}

export async function theOldUserCounterIsGoneAndTheYoungOneStays(ctx: PurgeCtx): Promise<void> {
  expect(await counterAges(ctx, "copilot_usage", "user_id", ctx.userA)).toEqual([30, 29]);
}

export async function theOldOrgCounterIsGoneAndTheYoungOneStays(ctx: PurgeCtx): Promise<void> {
  expect(await counterAges(ctx, "copilot_org_usage", "organization_id", ctx.orgA)).toEqual([30, 29]);
}

async function insertConversation(ctx: PurgeCtx, userId: string, age: string): Promise<string> {
  const { rows } = await withUser(ctx.tenantDb, userId, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_conversations (user_id, organization_id, title, created_at, last_turn_at)
      VALUES (${userId}, ${ctx.orgA}, 'F3.85 purge probe', now() - ${age}::interval, now() - ${age}::interval)
      RETURNING id`),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("F3.85: purge conversation was not created");
  return id;
}

async function insertMessage(ctx: PurgeCtx, conversationId: string): Promise<string> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content)
      VALUES (${conversationId}, ${ctx.userA}, 'user', 'F3.85 purge probe')
      RETURNING id`),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("F3.85: purge message was not created");
  return id;
}

async function insertChange(
  ctx: PurgeCtx,
  options: { conversationId: string | null; status: string; proposedAgo: string; claimedAgo?: string },
): Promise<string> {
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_pending_changes
        (user_id, conversation_id, organization_id, catalog_id, method, path, body, body_hash, summary, risk,
         status, proposed_at, expires_at, claimed_at)
      VALUES (${ctx.userA}, ${options.conversationId}, ${ctx.orgA}, 'dashboards.create', 'POST', '/api/v1/dashboards',
              '{}'::jsonb, repeat('a', 64), 'F3.85 purge probe', 'create', ${options.status},
              now() - ${options.proposedAgo}::interval, now() - ${options.proposedAgo}::interval + interval '1 hour',
              CASE WHEN ${options.claimedAgo ?? null}::text IS NULL THEN NULL
                   ELSE now() - ${options.claimedAgo ?? "0 seconds"}::interval END)
      RETURNING id`),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("F3.85: purge pending change was not created");
  return id;
}

/** Builds the aged rows every claim below reads. */
export async function seedPurgeFixture(ctx: PurgeCtx): Promise<PurgeFixture> {
  const convOld = await insertConversation(ctx, ctx.userA, "31 days");
  const convYoung = await insertConversation(ctx, ctx.userA, "29 days");
  return {
    convOld,
    msgOld: await insertMessage(ctx, convOld),
    appliedInOld: await insertChange(ctx, { conversationId: convOld, status: "applied", proposedAgo: "31 days" }),
    convYoung,
    msgYoung: await insertMessage(ctx, convYoung),
    orphanPendingOld: await insertChange(ctx, { conversationId: null, status: "pending", proposedAgo: "31 days" }),
    orphanPendingYoung: await insertChange(ctx, { conversationId: null, status: "pending", proposedAgo: "29 days" }),
    orphanRejectedOld: await insertChange(ctx, { conversationId: null, status: "rejected", proposedAgo: "31 days" }),
    pendingInYoungOld: await insertChange(ctx, { conversationId: convYoung, status: "pending", proposedAgo: "31 days" }),
    applyingOld: await insertChange(ctx, {
      conversationId: null,
      status: "applying",
      proposedAgo: "31 days",
      claimedAgo: "31 days",
    }),
    applyingYoung: await insertChange(ctx, {
      conversationId: null,
      status: "applying",
      proposedAgo: "29 days",
      claimedAgo: "29 days",
    }),
    convBOld: await insertConversation(ctx, ctx.userB, "31 days"),
  };
}

/**
 * The owner, with no `app.current_user`, deletes nothing — FORCE binds it, so
 * a purge with no setting is a no-op. Positive control in the same
 * transaction: with the setting, the same DELETE removes the row (then
 * ROLLBACK), so the zero is the policy and not a missing row.
 */
export async function theOwnerWithNoSettingDeletesNothing(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const client = await ctx.ownerPool.connect();
  try {
    await client.query("BEGIN");
    const unset = await client.query("DELETE FROM bms.copilot_conversations WHERE id = $1", [f.convOld]);
    await client.query("SELECT set_config('app.current_user', $1, true)", [ctx.userA]);
    const set = await client.query("DELETE FROM bms.copilot_conversations WHERE id = $1", [f.convOld]);
    await client.query("ROLLBACK");
    expect({ unset: unset.rowCount, set: set.rowCount }).toEqual({ unset: 0, set: 1 });
  } finally {
    client.release();
  }
}

/** Runs one tick on the database's clock, so the fixture's `now()` days and the cut-off date agree even at UTC midnight. */
export async function runThePurge(ctx: PurgeCtx): Promise<void> {
  const { rows } = await ctx.superPool.query<{ now: Date }>("SELECT now() AS now");
  await new CopilotPurgeService(ctx.tenantDb, ctx.fleetDb).purge(rows[0]!.now);
}

async function readAs(ctx: PurgeCtx, userId: string, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const { rows } = await withUser(ctx.tenantDb, userId, (tx) => tx.execute<Record<string, unknown>>(query));
  return rows;
}

export async function theOldConversationAndItsMessageAreGone(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(
    ctx,
    ctx.userA,
    sql`SELECT (SELECT count(*)::int FROM bms.copilot_conversations WHERE id = ${f.convOld}) AS conversations,
               (SELECT count(*)::int FROM bms.copilot_messages WHERE id = ${f.msgOld}) AS messages`,
  );
  expect(rows[0]).toEqual({ conversations: 0, messages: 0 });
}

export async function theAppliedChangeSurvivesWithANullConversation(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(
    ctx,
    ctx.userA,
    sql`SELECT status, conversation_id FROM bms.copilot_pending_changes WHERE id = ${f.appliedInOld}`,
  );
  expect(rows).toEqual([{ status: "applied", conversation_id: null }]);
}

export async function theYoungConversationAndItsMessageSurvive(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(
    ctx,
    ctx.userA,
    sql`SELECT (SELECT count(*)::int FROM bms.copilot_conversations WHERE id = ${f.convYoung}) AS conversations,
               (SELECT count(*)::int FROM bms.copilot_messages WHERE id = ${f.msgYoung}) AS messages`,
  );
  expect(rows[0]).toEqual({ conversations: 1, messages: 1 });
}

export async function theOldOrphanPendingChangeIsGoneAndTheYoungOneStays(
  ctx: PurgeCtx,
  f: PurgeFixture,
): Promise<void> {
  const rows = await readAs(
    ctx,
    ctx.userA,
    sql`SELECT id FROM bms.copilot_pending_changes WHERE id IN (${f.orphanPendingOld}, ${f.orphanPendingYoung})`,
  );
  expect(rows.map((r) => r.id)).toEqual([f.orphanPendingYoung]);
}

/** The `'rejected'` in step 2's predicate: an old orphaned rejected change goes too. */
export async function theOldOrphanRejectedChangeIsGone(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(ctx, ctx.userA, sql`SELECT id FROM bms.copilot_pending_changes WHERE id = ${f.orphanRejectedOld}`);
  expect(rows).toEqual([]);
}

/** The `conversation_id IS NULL` in step 2's predicate: an old pending change in a live conversation stays. */
export async function anOldPendingChangeInALiveConversationSurvives(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(
    ctx,
    ctx.userA,
    sql`SELECT status, conversation_id FROM bms.copilot_pending_changes WHERE id = ${f.pendingInYoungOld}`,
  );
  expect(rows).toEqual([{ status: "pending", conversation_id: f.convYoung }]);
}

export async function theOldApplyingClaimIsFailedAndTheYoungOneStays(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(
    ctx,
    ctx.userA,
    sql`SELECT id, status, finished_at IS NOT NULL AS finished FROM bms.copilot_pending_changes
         WHERE id IN (${f.applyingOld}, ${f.applyingYoung}) ORDER BY claimed_at`,
  );
  expect(rows).toEqual([
    { id: f.applyingOld, status: "failed", finished: true },
    { id: f.applyingYoung, status: "applying", finished: false },
  ]);
}

export async function theSecondUsersOldConversationIsGone(ctx: PurgeCtx, f: PurgeFixture): Promise<void> {
  const rows = await readAs(ctx, ctx.userB, sql`SELECT id FROM bms.copilot_conversations WHERE id = ${f.convBOld}`);
  expect(rows).toEqual([]);
}
