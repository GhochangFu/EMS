import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { withUser } from "../database/user-context";
import { CopilotConversationsController } from "./copilot-conversations.controller";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { EMPTY_COPILOT_READ_TOOLS } from "./copilot-read-tools";
import { CopilotTurnService } from "./copilot-turn.service";
import { CopilotUsageService } from "./copilot-usage.service";
import { UNUSED_COMMIT_READER, UNUSED_ONBOARDING_SKILL, UNUSED_SKILL_SERVICE } from "../testing/copilot-onboarding-fakes";

/**
 * `F3.85` PR 7 / ADR 0099 decision 8 — the messages a turn writes, on a real
 * database as `bms_tenant`: one user's messages are invisible to another user
 * and to `bms_fleet` (42501), including when the writer is the global admin
 * (`users.organization_id` NULL); a turn's two messages get distinct,
 * increasing `created_at` (`clock_timestamp()`, not the transaction's `now()`);
 * and a turn on another user's conversation is a 404. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */
export type HistoryCtx = {
  tenantDb: BmsDb;
  fleetPool: pg.Pool;
  /** Counter reads only: `bms_fleet` is revoked on the counters and they are per-user under FORCE. */
  superPool: pg.Pool;
  orgA: string;
  /** A second organization, named in a body to show it is never counted. */
  orgY: string;
  userA: string;
  userB: string;
  globalAdmin: string;
};

const conversations = (ctx: HistoryCtx) => new CopilotConversationsService(ctx.tenantDb);

/** Writes one turn's two messages for `userId` through the real write path. */
async function writeTurn(ctx: HistoryCtx, userId: string, organizationId: string | null): Promise<string> {
  const store = conversations(ctx);
  const conversation = await store.create(userId, organizationId);
  await store.appendTurn(userId, conversation.id, [
    { role: "user", content: "any alarms?", organizationIds: [] },
    { role: "assistant", content: "Two alarms.", organizationIds: organizationId ? [organizationId] : [] },
  ]);
  return conversation.id;
}

/** The messages of `conversationId` that `asUser` can see, under its own `app.current_user`. */
async function visibleCount(ctx: HistoryCtx, asUser: string, conversationId: string): Promise<number> {
  const { rows } = await withUser(ctx.tenantDb, asUser, (tx) =>
    tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM bms.copilot_messages WHERE conversation_id = ${conversationId}`),
  );
  return rows[0]?.n ?? -1;
}

/** A's messages: A sees both, B sees none. */
export async function aScopedAdminsMessagesAreInvisibleToAnotherUser(ctx: HistoryCtx): Promise<void> {
  const id = await writeTurn(ctx, ctx.userA, ctx.orgA);
  expect(await visibleCount(ctx, ctx.userA, id), "the writer reads its own two messages").toBe(2);
  expect(await visibleCount(ctx, ctx.userB, id), "another user reads none").toBe(0);
}

/** The global admin's messages (no home organization) are its own too: neither scoped user sees them. */
export async function theGlobalAdminsMessagesAreInvisibleToOtherUsers(ctx: HistoryCtx): Promise<void> {
  const id = await writeTurn(ctx, ctx.globalAdmin, null);
  expect(await visibleCount(ctx, ctx.globalAdmin, id), "the global admin reads its own two messages").toBe(2);
  expect(await visibleCount(ctx, ctx.userA, id), "user A reads none").toBe(0);
  expect(await visibleCount(ctx, ctx.userB, id), "user B reads none").toBe(0);
}

/** `bms_fleet` holds no privilege on the messages: a select fails with 42501, it does not read an empty set. */
export async function fleetIsRefusedTheMessages(ctx: HistoryCtx): Promise<void> {
  await writeTurn(ctx, ctx.globalAdmin, null);
  // Positive control: the fleet pool is connected and reads a table it is granted.
  const ok = await ctx.fleetPool.query<{ n: number }>("SELECT count(*)::int AS n FROM bms.organizations");
  expect(ok.rows[0]?.n).toBeGreaterThan(0);
  const error = await ctx.fleetPool.query("SELECT count(*) FROM bms.copilot_messages").then(
    () => null,
    (err: { code?: string }) => err,
  );
  expect(error?.code, "42501 is the permission refusal").toBe("42501");
}

/**
 * One turn's messages are written in one transaction; each gets its own
 * `clock_timestamp()`, so the reply is strictly later and `get` reads them back
 * in order. Mutation: drop the explicit `created_at` (the column default
 * `now()` ties them) → red.
 */
export async function aTurnsMessagesHaveDistinctIncreasingCreatedAt(ctx: HistoryCtx): Promise<void> {
  const store = conversations(ctx);
  const conversation = await store.create(ctx.userA, ctx.orgA);
  const stored = await store.appendTurn(ctx.userA, conversation.id, [
    { role: "user", content: "first", organizationIds: [] },
    { role: "assistant", content: "second", organizationIds: [ctx.orgA] },
  ]);
  const [user, assistant] = stored;
  expect(user?.createdAt).toBeDefined();
  // The DTO's `createdAt` is a JS Date (milliseconds); two inserts can share a millisecond on a
  // fast runner. "Strictly later" is compared in the database, at its microsecond precision.
  expect(Date.parse(assistant?.createdAt ?? "") >= Date.parse(user?.createdAt ?? "")).toBe(true);
  const { rows } = await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute<{ distinct_at: number; reply_later: boolean }>(
      sql`SELECT count(DISTINCT created_at)::int AS distinct_at,
                 max(created_at) FILTER (WHERE role = 'assistant') > max(created_at) FILTER (WHERE role = 'user') AS reply_later
            FROM bms.copilot_messages WHERE conversation_id = ${conversation.id}`,
    ),
  );
  expect(rows[0]?.distinct_at, "the two rows never tie").toBe(2);
  expect(rows[0]?.reply_later, "the reply is strictly later than the user's message").toBe(true);
  const detail = await store.get(ctx.userA, conversation.id);
  expect(detail?.messages.map((m) => m.content)).toEqual(["first", "second"]);
  expect(detail?.messages[1]?.organizationIds).toEqual([ctx.orgA]);
  expect(Date.parse(detail?.lastTurnAt ?? "") >= Date.parse(assistant?.createdAt ?? "")).toBe(true);
}

/**
 * History is the conversation's **last** 20 messages, oldest first, read by
 * the real query. Mutation: order `asc` instead of `desc` (the first 20) → red.
 */
export async function recentMessagesAreTheLast20OldestFirst(ctx: HistoryCtx): Promise<void> {
  const store = conversations(ctx);
  const conversation = await store.create(ctx.userA, ctx.orgA);
  await withUser(ctx.tenantDb, ctx.userA, (tx) =>
    tx.execute(sql`
      INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content, created_at)
      SELECT ${conversation.id}::uuid, ${ctx.userA}::uuid, 'user', 'm' || lpad(n::text, 2, '0'),
             now() - interval '1 hour' + n * interval '1 second'
        FROM generate_series(1, 22) AS n`),
  );
  const recent = await store.recentMessages(ctx.userA, conversation.id, 20);
  expect(recent.map((m) => m.content)).toEqual(Array.from({ length: 20 }, (_, i) => `m${String(i + 3).padStart(2, "0")}`));
}

async function orgCounter(ctx: HistoryCtx, organizationId: string): Promise<number | null> {
  const { rows } = await ctx.superPool.query<{ turns: number }>(
    "SELECT sum(turns)::int AS turns FROM bms.copilot_org_usage WHERE organization_id = $1",
    [organizationId],
  );
  return rows[0]?.turns ?? null;
}

/**
 * Decision 10 with the real counters: a global admin's conversation bound to X
 * is counted on X. A turn whose body names Y is a 400 (the body is the message
 * alone; the route reads no query) and Y's counter stays absent.
 */
export async function aBodyNamingAnotherOrganizationNeverCountsIt(ctx: HistoryCtx): Promise<void> {
  const store = conversations(ctx);
  const usage = new CopilotUsageService(ctx.tenantDb, { userDailyTurns: 150, organizationDailyTurns: 1_500 });
  const llm = new FakeLlmProvider([{ kind: "final", text: "ok" }]);
  const turns = new CopilotTurnService(
    store,
    { decide: async () => ({ available: true }), organizationSwitchOn: async () => true } as never,
    { resolveForOrganization: async () => ({ kind: "ready", provider: llm, source: "organization" }) } as never,
    usage,
    EMPTY_COPILOT_READ_TOOLS,
    EMPTY_COPILOT_READ_TOOLS,
    new CopilotPendingChangesService(ctx.tenantDb),
    UNUSED_ONBOARDING_SKILL,
    UNUSED_COMMIT_READER as never,
  );
  const controller = new CopilotConversationsController(
    store,
    { decide: async () => ({ available: true }) } as never,
    new CopilotPendingChangesService(ctx.tenantDb),
    turns,
    UNUSED_SKILL_SERVICE,
  );
  const admin = identity(ctx.globalAdmin, "admin", null);
  const jwt = { sub: ctx.globalAdmin, email: "g@x.test", role: "admin" } as JwtPayload;
  const bound = await store.create(ctx.globalAdmin, ctx.orgA);
  const beforeX = (await orgCounter(ctx, ctx.orgA)) ?? 0;

  await controller.turn(bound.id, { message: "any alarms?", wizards: [] }, admin, jwt);
  expect(await orgCounter(ctx, ctx.orgA), "the positive control: the turn counted on X").toBe(beforeX + 1);

  const error = await controller.turn(bound.id, { message: "any alarms?", wizards: [], organizationId: ctx.orgY }, admin, jwt).then(
    () => null,
    (err: { getStatus?: () => number }) => err,
  );
  expect(error?.getStatus?.()).toBe(400);
  expect(await orgCounter(ctx, ctx.orgY), "Y was never counted").toBeNull();
  expect(await orgCounter(ctx, ctx.orgA), "nor was X again").toBe(beforeX + 1);
}

function identity(id: string, role: ResolvedIdentity["role"], organizationId: string | null): ResolvedIdentity {
  return { id, email: `${id}@x.test`, displayName: id, role, organizationId, oidcSubject: null, disabledAt: null } as ResolvedIdentity;
}

/** A turn service on the real store; the key, the switch and the counters are fakes (their own suites). */
function turnService(ctx: HistoryCtx, llm: FakeLlmProvider, counted: Array<string | null>) {
  return new CopilotTurnService(
    conversations(ctx),
    { decide: async () => ({ available: true }), organizationSwitchOn: async () => true } as never,
    {
      resolveForOrganization: async () => ({ kind: "ready", provider: llm, source: "organization" }),
      resolvePlatformScope: async () => ({ kind: "ready", provider: llm, source: "platform", allowedOrganizationIds: [] }),
    } as never,
    {
      consumeTurn: async (_who: unknown, organizationId: string | null) => {
        counted.push(organizationId);
        return { ok: true };
      },
    } as never,
    EMPTY_COPILOT_READ_TOOLS,
    EMPTY_COPILOT_READ_TOOLS,
    new CopilotPendingChangesService(ctx.tenantDb),
    UNUSED_ONBOARDING_SKILL,
    UNUSED_COMMIT_READER as never,
  );
}

/**
 * B's turn on A's conversation is a 404 — the policy hides the row — and
 * nothing is counted or sent. The positive control: A's own turn answers and
 * stores both messages, counted on the conversation's organization.
 */
export async function aTurnOnAnotherUsersConversationIs404(ctx: HistoryCtx): Promise<void> {
  const store = conversations(ctx);
  const mine = await store.create(ctx.userA, ctx.orgA);
  const jwt = { sub: ctx.userB, email: "b@x.test", role: "organization_admin" } as JwtPayload;

  const llmB = new FakeLlmProvider([{ kind: "final", text: "leak" }]);
  const countedB: Array<string | null> = [];
  const error = await turnService(ctx, llmB, countedB)
    .turn({ identity: identity(ctx.userB, "organization_admin", ctx.orgA), user: jwt }, mine.id, "hello", "user", [], [])
    .then(
      () => null,
      (err: { getStatus?: () => number }) => err,
    );
  expect(error?.getStatus?.()).toBe(404);
  expect(countedB).toEqual([]);
  expect(llmB.calls).toBe(0);

  const llmA = new FakeLlmProvider([{ kind: "final", text: "Hello." }]);
  const countedA: Array<string | null> = [];
  const response = await turnService(ctx, llmA, countedA).turn(
    { identity: identity(ctx.userA, "organization_admin", ctx.orgA), user: { ...jwt, sub: ctx.userA } },
    mine.id,
    "hello",
    "user",
    [],
    [],
  );
  expect(response.outcome).toBe("answered");
  expect(response.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(countedA).toEqual([ctx.orgA]);
  expect(await visibleCount(ctx, ctx.userA, mine.id)).toBe(2);
}
