import { sql } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { withUser } from "../database/user-context";
import { CopilotConversationsController } from "./copilot-conversations.controller";
import { CopilotConversationsService } from "./copilot-conversations.service";
import type { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import type { CopilotTurnService } from "./copilot-turn.service";
import { SPEC_JWT, UNUSED_SKILL_SERVICE } from "../testing/copilot-onboarding-fakes";

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — the conversation routes against migration
 * `0105` on a real database, as `bms_tenant`: another user's conversation is a
 * 404, the list is newest-turn first and bounded, a read returns the messages
 * in order, and a create records the binding. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */
export type ConversationsCtx = {
  tenantDb: BmsDb;
  orgA: string;
  userA: string;
  userB: string;
  /** `F3.86` PR 5: two draft onboarding sessions of `orgA`, for the conditional bind. */
  sessions: readonly [string, string];
  /** `F4.255`: one draft session per resume case, so no case sees another's bindings. */
  resumeSessions: readonly [string, string, string];
};

const available = { decide: async () => ({ available: true }) } as unknown as CopilotAvailabilityService;

function controller(ctx: ConversationsCtx) {
  return new CopilotConversationsController(
    new CopilotConversationsService(ctx.tenantDb),
    available,
    new CopilotPendingChangesService(ctx.tenantDb),
    // These cases never reach the turn route (`copilot-history.rls.integration.spec.ts` does).
    {} as CopilotTurnService,
    UNUSED_SKILL_SERVICE,
  );
}

function identity(ctx: ConversationsCtx, userId: string, role: ResolvedIdentity["role"]): ResolvedIdentity {
  return {
    id: userId,
    email: `${userId}@example.test`,
    displayName: userId,
    role,
    organizationId: ctx.orgA,
    oidcSubject: null,
    disabledAt: null,
  } as ResolvedIdentity;
}

async function expectNotFound(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(404);
    return;
  }
  throw new Error("expected a 404");
}

/** A scoped create records the home organization and the caller; the global admin's null stays null. */
export async function createRecordsTheBinding(ctx: ConversationsCtx): Promise<void> {
  const scoped = await controller(ctx).create({ organizationId: null }, identity(ctx, ctx.userA, "organization_admin"));
  expect(scoped.organizationId).toBe(ctx.orgA);
  const read = await controller(ctx).get(scoped.id, identity(ctx, ctx.userA, "organization_admin"), SPEC_JWT);
  expect(read).toMatchObject({ id: scoped.id, organizationId: ctx.orgA, messages: [] });

  const global = await controller(ctx).create({ organizationId: null }, identity(ctx, ctx.userA, "admin"));
  expect(global.organizationId).toBeNull();
}

/** User B asking for user A's conversation gets a 404, and B's list does not hold it. */
export async function anotherUsersConversationIs404(ctx: ConversationsCtx): Promise<void> {
  const mine = await controller(ctx).create({ organizationId: null }, identity(ctx, ctx.userA, "organization_admin"));
  const asB = identity(ctx, ctx.userB, "organization_admin");
  await expectNotFound(() => controller(ctx).get(mine.id, asB, SPEC_JWT));
  const listed = await controller(ctx).list(asB);
  expect(listed.map((c) => c.id)).not.toContain(mine.id);
  // The positive control: the owner reads it.
  const own = await controller(ctx).get(mine.id, identity(ctx, ctx.userA, "organization_admin"), SPEC_JWT);
  expect(own.id).toBe(mine.id);
}

/** The list is newest turn first; a read returns the messages oldest first. */
export async function listIsNewestFirstAndMessagesAreOrdered(ctx: ConversationsCtx): Promise<void> {
  const caller = identity(ctx, ctx.userB, "organization_admin");
  const older = await controller(ctx).create({ organizationId: null }, caller);
  const newer = await controller(ctx).create({ organizationId: null }, caller);
  await withUser(ctx.tenantDb, ctx.userB, async (tx) => {
    await tx.execute(sql`UPDATE bms.copilot_conversations SET last_turn_at = now() - interval '2 hours' WHERE id = ${older.id}`);
    await tx.execute(sql`UPDATE bms.copilot_conversations SET last_turn_at = now() - interval '1 hour' WHERE id = ${newer.id}`);
    // Inserted newest first so the order cannot be insertion order.
    await tx.execute(sql`
      INSERT INTO bms.copilot_messages (conversation_id, user_id, role, content, created_at)
      VALUES (${older.id}, ${ctx.userB}, 'assistant', 'second', now() - interval '1 minute'),
             (${older.id}, ${ctx.userB}, 'user', 'first', now() - interval '2 minutes')`);
  });
  const ids = (await controller(ctx).list(caller)).map((c) => c.id);
  expect(ids.indexOf(newer.id)).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  const detail = await controller(ctx).get(older.id, caller, SPEC_JWT);
  expect(detail.messages.map((m) => m.content)).toEqual(["first", "second"]);
  expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
}

/**
 * `F3.86` PR 5 (code review, false green 1) — the bind holds only while none
 * is bound: a second bind answers false and leaves the first session bound;
 * after an unbind a bind answers true again (the positive control). Run as
 * `bms_tenant` in `withUser`, so the `user_isolation` policy applies too:
 * another user's bind of the same conversation changes nothing.
 */
export async function aBindHoldsOnlyWhileNoneIsBound(ctx: ConversationsCtx): Promise<void> {
  const store = new CopilotConversationsService(ctx.tenantDb);
  const conversation = await store.create(ctx.userA, ctx.orgA);
  const [first, second] = ctx.sessions;
  expect(await store.bindOnboardingSession(ctx.userA, conversation.id, first)).toBe(true);
  expect(await store.bindOnboardingSession(ctx.userA, conversation.id, second)).toBe(false);
  expect((await store.findConversation(ctx.userA, conversation.id))?.onboardingSessionId).toBe(first);
  expect(await store.bindOnboardingSession(ctx.userB, conversation.id, second)).toBe(false);
  await store.unbindOnboardingSession(ctx.userA, conversation.id);
  expect((await store.findConversation(ctx.userA, conversation.id))?.onboardingSessionId).toBeNull();
  expect(await store.bindOnboardingSession(ctx.userA, conversation.id, second)).toBe(true);
  expect((await store.findConversation(ctx.userA, conversation.id))?.onboardingSessionId).toBe(second);
}

/*
 * `F4.255` (ADR 0099 Amendment 2 A1) — `unbindSessionElsewhere`, as
 * `bms_tenant` in `withUser`: a resume frees the caller's other conversations
 * from the session and keeps the one it binds. Two conversations may hold one
 * session (the `0107` index is not unique). **Another user's binding stays
 * because `user_isolation` hides their row, not because of the `userId`
 * predicate** — dropping `eq(userId)` stays green by the policy, so that
 * predicate is not gated here; the `ne(id, keep)` predicate is.
 */
async function bindTwoOfMine(ctx: ConversationsCtx, sessionId: string) {
  const store = new CopilotConversationsService(ctx.tenantDb);
  const older = await store.create(ctx.userA, ctx.orgA);
  const resumed = await store.create(ctx.userA, ctx.orgA);
  expect(await store.bindOnboardingSession(ctx.userA, older.id, sessionId)).toBe(true);
  expect(await store.bindOnboardingSession(ctx.userA, resumed.id, sessionId)).toBe(true);
  return { store, older, resumed };
}

/** The caller's other conversation is freed, and the answer names it (the resume discards its commit card). */
export async function aResumeFreesTheCallersOtherConversation(ctx: ConversationsCtx): Promise<void> {
  const session = ctx.resumeSessions[0];
  const { store, older, resumed } = await bindTwoOfMine(ctx, session);
  expect(await store.unbindSessionElsewhere(ctx.userA, session, resumed.id)).toEqual([older.id]);
  expect((await store.findConversation(ctx.userA, older.id))?.onboardingSessionId).toBeNull();
}

/** The conversation the resume binds keeps the session. */
export async function aResumeKeepsTheResumedConversation(ctx: ConversationsCtx): Promise<void> {
  const session = ctx.resumeSessions[1];
  const { store, resumed } = await bindTwoOfMine(ctx, session);
  await store.unbindSessionElsewhere(ctx.userA, session, resumed.id);
  expect((await store.findConversation(ctx.userA, resumed.id))?.onboardingSessionId).toBe(session);
}

/** Another user's conversation bound to the session keeps it (read as that user). */
export async function aResumeLeavesAnotherUsersBinding(ctx: ConversationsCtx): Promise<void> {
  const session = ctx.resumeSessions[2];
  const { store, resumed } = await bindTwoOfMine(ctx, session);
  const theirs = await store.create(ctx.userB, ctx.orgA);
  expect(await store.bindOnboardingSession(ctx.userB, theirs.id, session)).toBe(true);
  await store.unbindSessionElsewhere(ctx.userA, session, resumed.id);
  expect((await store.findConversation(ctx.userB, theirs.id))?.onboardingSessionId).toBe(session);
}
