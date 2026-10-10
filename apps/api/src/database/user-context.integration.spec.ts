import { sql } from "drizzle-orm";
import pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withUser } from "./user-context";

/**
 * `F3.85` PR 4 / ADR 0099 decision 8 — `withUser` and the `user_isolation`
 * policy of migration `0105`, on a real database. Every read that must see
 * nothing has a positive control beside it: an empty result is also what a
 * missing grant or an empty table answers. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 *
 * The probe table is `bms.copilot_conversations` (its organization may be
 * NULL, so a row needs nothing but a user). Rows cascade away with their
 * user, which the entry file deletes in `afterAll`.
 */
export type UserContextCtx = {
  /** `withUser` runs on this — the `bms_tenant` role, bound by the policy. */
  tenantDb: BmsDb;
  /** `bms_tenant` again, as a raw pool, for the no-setting read. */
  tenantPool: pg.Pool;
  /** `bms_fleet` — BYPASSRLS, and revoked on the three tables. */
  fleetPool: pg.Pool;
  /** `bms_owner` — the table owner, bound by the policy only through `FORCE`. */
  ownerPool: pg.Pool;
  orgA: string;
  userA: string;
  userB: string;
};

type PgLikeError = { code?: string; message?: string };

function pgErrorOf(err: unknown): PgLikeError {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as PgLikeError & { cause?: unknown };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

async function refusal(fn: () => Promise<unknown>, what: string): Promise<PgLikeError> {
  try {
    await fn();
  } catch (err) {
    return pgErrorOf(err);
  }
  throw new Error(`${what}: the statement succeeded, and it must be refused`);
}

async function insertConversation(ctx: UserContextCtx, userId: string, title: string): Promise<string> {
  const rows = await withUser(ctx.tenantDb, userId, (tx) =>
    tx.execute<{ id: string }>(sql`
      INSERT INTO bms.copilot_conversations (user_id, title) VALUES (${userId}, ${title}) RETURNING id`),
  );
  const id = rows.rows[0]?.id;
  if (!id) throw new Error(`F3.85: conversation "${title}" was not created`);
  return id;
}

async function visibleTo(ctx: UserContextCtx, userId: string, id: string): Promise<number> {
  const rows = await withUser(ctx.tenantDb, userId, (tx) =>
    tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM bms.copilot_conversations WHERE id = ${id}`),
  );
  return rows.rows[0]?.n ?? -1;
}

/** A row written inside `withUser(A)` is visible inside `withUser(A)` and to no one else on `bms_tenant`. */
export async function aUserSeesOnlyItsOwnRows(ctx: UserContextCtx): Promise<void> {
  const id = await insertConversation(ctx, ctx.userA, "F3.85 user-context A");
  expect(await visibleTo(ctx, ctx.userA, id), "A reads its own row").toBe(1);
  expect(await visibleTo(ctx, ctx.userB, id), "B does not read A's row").toBe(0);

  const client = await ctx.tenantPool.connect();
  try {
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM bms.copilot_conversations WHERE id = $1",
      [id],
    );
    expect(rows[0]?.n, "bms_tenant with no user set reads nothing").toBe(0);
  } finally {
    client.release();
  }
}

/** `WITH CHECK` refuses a row for another user: 42501, naming row-level security, and no row is left. */
export async function aUserCannotWriteAnotherUsersRow(ctx: UserContextCtx): Promise<void> {
  const err = await refusal(
    () =>
      withUser(ctx.tenantDb, ctx.userA, (tx) =>
        tx.execute(sql`
          INSERT INTO bms.copilot_conversations (user_id, title) VALUES (${ctx.userB}, 'F3.85 forged')`),
      ),
    "A wrote a row for B",
  );
  expect(err.code, `expected 42501, got ${err.code}: ${err.message}`).toBe("42501");
  expect(err.message).toMatch(/row-level security/);
  const { rows } = await ctx.ownerPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.copilot_conversations WHERE title = 'F3.85 forged'",
  );
  // The owner is bound by FORCE too, so its 0 proves nothing alone; the next case's positive control backs it.
  expect(rows[0]?.n).toBe(0);
}

/** `bms_fleet` reads across organizations, so it holds no privilege at all: a read is refused, not filtered. */
export async function theFleetRoleIsRefusedOnEveryTable(ctx: UserContextCtx): Promise<void> {
  for (const table of ["copilot_conversations", "copilot_messages", "copilot_pending_changes"]) {
    const err = await refusal(() => ctx.fleetPool.query(`SELECT 1 FROM bms.${table} LIMIT 1`), `fleet read ${table}`);
    expect(err.code, `${table}: expected 42501, got ${err.code}: ${err.message}`).toBe("42501");
    expect(err.message).toMatch(/permission denied/);
  }
}

/** The owner sees nothing without a user, and the same row once `app.current_user` names its user. */
export async function theOwnerIsBoundByTheUserPolicy(ctx: UserContextCtx): Promise<void> {
  const id = await insertConversation(ctx, ctx.userA, "F3.85 user-context owner");
  const without = await ctx.ownerPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.copilot_conversations WHERE id = $1",
    [id],
  );
  expect(without.rows[0]?.n, "the owner with no user reads nothing").toBe(0);

  const client = await ctx.ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user', $1, true)", [ctx.userA]);
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM bms.copilot_conversations WHERE id = $1",
      [id],
    );
    await client.query("COMMIT");
    expect(rows[0]?.n, "positive control: the owner reads the row under A").toBe(1);
  } finally {
    client.release();
  }
}

/**
 * Both settings are transaction-local: on one pooled connection, the next
 * transaction sees neither. `opts.organizationId` sets the organization in the
 * same transaction.
 */
export async function theSettingsDoNotOutliveTheTransaction(ctx: UserContextCtx, single: BmsDb): Promise<void> {
  const inside = await withUser(
    single,
    ctx.userA,
    (tx) =>
      tx.execute<{ u: string; o: string }>(sql`
        SELECT current_setting('app.current_user', true) AS u,
               current_setting('app.current_organization', true) AS o`),
    { organizationId: ctx.orgA },
  );
  expect(inside.rows[0]).toEqual({ u: ctx.userA, o: ctx.orgA });

  const after = await single.execute<{ u: string | null; o: string | null }>(sql`
    SELECT nullif(current_setting('app.current_user', true), '') AS u,
           nullif(current_setting('app.current_organization', true), '') AS o`);
  expect(after.rows[0]).toEqual({ u: null, o: null });
}

/**
 * A message or a pending change joins only a conversation of its own user:
 * the composite key `(conversation_id, user_id)` refuses A's row naming B's
 * conversation with 23503, though `WITH CHECK` passes (the row's own user is
 * A). Without the composite key the foreign-key check runs with row security
 * off and would accept it. The positive control is A's row naming A's own
 * conversation; erasing that conversation keeps A's pending change and nulls
 * only its conversation (drafter choice 8).
 */
export async function aChildRowJoinsOnlyItsOwnUsersConversation(ctx: UserContextCtx): Promise<void> {
  const own = await insertConversation(ctx, ctx.userA, "F3.85 composite A");
  const foreign = await insertConversation(ctx, ctx.userB, "F3.85 composite B");

  const message = await refusal(
    () =>
      withUser(ctx.tenantDb, ctx.userA, (tx) =>
        tx.execute(sql`
          INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content)
          VALUES (${foreign}, ${ctx.userA}, 'user', 'F3.85 forged message')`),
      ),
    "A's message joined B's conversation",
  );
  expect(message.code, `expected 23503, got ${message.code}: ${message.message}`).toBe("23503");

  const insertPending = (conversationId: string) =>
    withUser(ctx.tenantDb, ctx.userA, (tx) =>
      tx.execute<{ id: string }>(sql`
        INSERT INTO bms.copilot_pending_changes
          (user_id, conversation_id, organization_id, catalog_id, method, path, body, body_hash, summary, risk, status, expires_at)
        VALUES (${ctx.userA}, ${conversationId}, ${ctx.orgA}, 'f385.probe', 'POST', '/api/v1/probe', '{}'::jsonb,
                repeat('0', 64), 'F3.85 probe', 'create', 'pending', now() + interval '1 hour')
        RETURNING id`),
    );
  const pending = await refusal(() => insertPending(foreign), "A's pending change joined B's conversation");
  expect(pending.code, `expected 23503, got ${pending.code}: ${pending.message}`).toBe("23503");

  // Positive control: the same rows under A's own conversation are accepted.
  await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute(sql`
      INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content)
      VALUES (${own}, ${ctx.userA}, 'user', 'F3.85 own message')`),
  );
  const created = await insertPending(own);
  const pendingId = created.rows[0]?.id;
  expect(pendingId, "A's pending change under A's conversation").toBeDefined();

  // Erasing the conversation removes its messages and keeps the pending change, unlinked.
  await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute(sql`DELETE FROM bms.copilot_conversations WHERE id = ${own}`),
  );
  const after = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ messages: number; conversation_id: string | null; user_id: string }>(sql`
      SELECT (SELECT count(*)::int FROM bms.copilot_messages WHERE conversation_id = ${own}) AS messages,
             conversation_id, user_id
        FROM bms.copilot_pending_changes WHERE id = ${pendingId as string}`),
  );
  expect(after.rows[0]).toEqual({ messages: 0, conversation_id: null, user_id: ctx.userA });
}
