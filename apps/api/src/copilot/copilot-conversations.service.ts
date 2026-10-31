import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { type BmsDb, copilotConversations, copilotMessages, organizations } from "@bms/db";
import type { CopilotConversationDetailDto, CopilotConversationDto, CopilotMessageDto } from "@bms/shared";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withUser } from "../database/user-context";

/** The list returns at most this many conversations, newest turn first. */
export const COPILOT_CONVERSATION_LIST_LIMIT = 100;

/** `F4.292` — the most characters a conversation title holds (`copilot_conversations.title` is `varchar(200)`). */
export const COPILOT_CONVERSATION_TITLE_MAX = 200;

/** `F4.292` — a paged read's `before` names no message of this conversation (the controller answers 404). */
export class CopilotCursorNotFoundError extends Error {
  constructor() {
    super("F4.292: the before cursor names no message of this conversation");
    this.name = "CopilotCursorNotFoundError";
  }
}

/** `F4.292` — one page: the newest `limit` messages older than `before` (or the newest, without it). */
export type CopilotConversationPage = { before?: string; limit: number };

/**
 * `F4.292` (ADR 0099 Amendment 9 E7, owner ruling P6) — the title a turn gives a
 * conversation: the first non-empty line of its user messages, trimmed, that is
 * not an attachment record (`[Attachment …`), cut to
 * `COPILOT_CONVERSATION_TITLE_MAX` characters. `null` when the turn holds no
 * such line (an action-only turn, a blank user message), so `coalesce` leaves
 * the title for a later turn rather than fixing `""` for good.
 */
export function conversationTitleOf(messages: ReadonlyArray<{ role: string; content: string }>): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const raw of message.content.split("\n")) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("[Attachment")) continue;
      // By code point, as `varchar(200)` counts: a cut never splits a surrogate pair.
      return Array.from(line).slice(0, COPILOT_CONVERSATION_TITLE_MAX).join("");
    }
  }
  return null;
}

type ConversationRow = typeof copilotConversations.$inferSelect;
type MessageRow = typeof copilotMessages.$inferSelect;

function toConversation(row: ConversationRow): CopilotConversationDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastTurnAt: row.lastTurnAt.toISOString(),
  };
}

function toMessage(row: MessageRow): CopilotMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as CopilotMessageDto["role"],
    content: row.content,
    organizationIds: row.organizationIds,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — the copilot conversation store. The
 * controller keeps the HTTP shape (the sweep, the body, the binding rule, the
 * errors); this service owns the queries, so PR 7's turn service reads and
 * writes history through the same code. Every read and write of the
 * caller's history runs in `withUser`, so the `user_isolation` policy hides
 * another user's rows.
 */
@Injectable()
export class CopilotConversationsService {
  constructor(@Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb) {}

  /** Whether an organization with this id exists (the global admin's binding, Q9). */
  async organizationExists(organizationId: string): Promise<boolean> {
    const [org] = await this.tenantDb
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return Boolean(org);
  }

  /** Records a conversation for the caller, bound to `organizationId` (null: cross-organization). */
  async create(userId: string, organizationId: string | null): Promise<CopilotConversationDto> {
    const [row] = await withUser(this.tenantDb, userId, (tx) =>
      tx.insert(copilotConversations).values({ userId, organizationId }).returning(),
    );
    if (!row) throw new Error("F3.85: the conversation was not created");
    return toConversation(row);
  }

  /** The caller's conversations, newest turn first, at most `COPILOT_CONVERSATION_LIST_LIMIT`. */
  async list(userId: string): Promise<CopilotConversationDto[]> {
    const rows = await withUser(this.tenantDb, userId, (tx) =>
      tx
        .select()
        .from(copilotConversations)
        .where(eq(copilotConversations.userId, userId))
        .orderBy(desc(copilotConversations.lastTurnAt))
        .limit(COPILOT_CONVERSATION_LIST_LIMIT),
    );
    return rows.map(toConversation);
  }

  /**
   * One of the caller's conversations with its messages, or null when the
   * policy hides it (another user's) or it does not exist.
   *
   * **Ordering contract.** Messages are read `ORDER BY created_at, id`. `id`
   * is a random uuid, so the tie-breaker only makes a tie deterministic (and
   * the page cursor total); it is not the order of writing. `created_at`
   * defaults to `now()`, which is fixed at transaction start, so two messages
   * inserted in one transaction would tie and read back in uuid order. A
   * writer (PR 7's turn service) must therefore insert each message with a
   * distinct `created_at` — `clock_timestamp()` or an explicit increasing
   * value — and pin that in its own test, or a migration adds an ordinal.
   *
   * The controller adds its open changes (`pendingChanges`, F3.85 PR 8), from
   * `onboardingSessionId` its skill (F3.86 PR 5), and the follow-up it waits
   * for (`awaitingFollowUp`, F4.244).
   *
   * **`F4.292` — a page** (ADR 0099 Amendment 9 E7). With `page` the read is
   * the newest `page.limit` messages, older than `page.before` when it is set,
   * still oldest first, and it carries `hasEarlier`. The keyset compare
   * `(created_at, id) < cursor` runs in SQL against the cursor row itself: a
   * JS `Date` holds milliseconds and `created_at` microseconds, so a cursor
   * read into JS and bound back would skip an older row of the same
   * millisecond. A `before` that names no message **of this conversation**
   * throws `CopilotCursorNotFoundError`. Without `page` the read is unchanged
   * and has no `hasEarlier` key (Amendment 6 D6(b)).
   */
  async get(
    userId: string,
    conversationId: string,
    page?: CopilotConversationPage,
  ): Promise<(Omit<CopilotConversationDetailDto, "pendingChanges" | "skill" | "awaitingFollowUp"> & { onboardingSessionId: string | null }) | null> {
    const found = await withUser(this.tenantDb, userId, async (tx) => {
      const [conversation] = await tx
        .select()
        .from(copilotConversations)
        .where(and(eq(copilotConversations.id, conversationId), eq(copilotConversations.userId, userId)))
        .limit(1);
      if (!conversation) return null;
      if (!page) {
        const messages = await tx
          .select()
          .from(copilotMessages)
          .where(eq(copilotMessages.conversationId, conversationId))
          .orderBy(asc(copilotMessages.createdAt), asc(copilotMessages.id));
        return { conversation, messages, hasEarlier: undefined };
      }
      const { before } = page;
      if (before !== undefined) {
        const [cursor] = await tx
          .select({ id: copilotMessages.id })
          .from(copilotMessages)
          .where(and(eq(copilotMessages.id, before), eq(copilotMessages.conversationId, conversationId)))
          .limit(1);
        if (!cursor) throw new CopilotCursorNotFoundError();
      }
      // The cursor row's own (created_at, id), read in SQL: no millisecond round trip through JS.
      const olderThanCursor =
        before === undefined
          ? undefined
          : sql`(${copilotMessages.createdAt}, ${copilotMessages.id}) < (select cursor.created_at, cursor.id from ${copilotMessages} as cursor where cursor.id = ${before} and cursor.conversation_id = ${conversationId})`;
      const newestFirst = await tx
        .select()
        .from(copilotMessages)
        .where(and(eq(copilotMessages.conversationId, conversationId), olderThanCursor))
        .orderBy(desc(copilotMessages.createdAt), desc(copilotMessages.id))
        .limit(page.limit + 1);
      const hasEarlier = newestFirst.length > page.limit;
      return { conversation, messages: newestFirst.slice(0, page.limit).reverse(), hasEarlier };
    });
    if (!found) return null;
    return {
      ...toConversation(found.conversation),
      messages: found.messages.map(toMessage),
      onboardingSessionId: found.conversation.onboardingSessionId,
      ...(found.hasEarlier !== undefined ? { hasEarlier: found.hasEarlier } : {}),
    };
  }

  /**
   * `F3.85` PR 7 — the caller's conversation and its bound organization, or
   * null when the policy hides it or it does not exist. The turn service
   * reads a turn's organization **here and nowhere else** (decision 10).
   * `F3.86` PR 5: and the onboarding session the skill binds, or null.
   */
  async findConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ id: string; organizationId: string | null; onboardingSessionId: string | null } | null> {
    const [row] = await withUser(this.tenantDb, userId, (tx) =>
      tx
        .select({
          id: copilotConversations.id,
          organizationId: copilotConversations.organizationId,
          onboardingSessionId: copilotConversations.onboardingSessionId,
        })
        .from(copilotConversations)
        .where(and(eq(copilotConversations.id, conversationId), eq(copilotConversations.userId, userId)))
        .limit(1),
    );
    return row ?? null;
  }

  /**
   * `F3.86` PR 5 (decision 7) — binds the onboarding session to the caller's
   * conversation, only while it binds none: false when another start won the
   * race, so the route answers 409 rather than replacing the bound session.
   */
  async bindOnboardingSession(userId: string, conversationId: string, sessionId: string): Promise<boolean> {
    const rows = await withUser(this.tenantDb, userId, (tx) =>
      tx
        .update(copilotConversations)
        .set({ onboardingSessionId: sessionId })
        .where(
          and(
            eq(copilotConversations.id, conversationId),
            eq(copilotConversations.userId, userId),
            isNull(copilotConversations.onboardingSessionId),
          ),
        )
        .returning({ id: copilotConversations.id }),
    );
    return rows.length === 1;
  }

  /** `F3.86` PR 5 — ends the skill in the caller's conversation; the session stays a draft the dock lists and can resume (`F4.255`). */
  async unbindOnboardingSession(userId: string, conversationId: string): Promise<void> {
    await withUser(this.tenantDb, userId, (tx) =>
      tx
        .update(copilotConversations)
        .set({ onboardingSessionId: null })
        .where(and(eq(copilotConversations.id, conversationId), eq(copilotConversations.userId, userId))),
    );
  }

  /**
   * `F4.255` (ADR 0099 Amendment 2 A1) — a resume frees the caller's **other**
   * conversations from `sessionId`, keeping `keepConversationId`; answers the
   * ids it freed, so the resume can discard each one's open `onboarding.commit`
   * card as `end` does. Another user's binding is invisible here
   * (`user_isolation`), so it stays: two administrators may hold one draft (no
   * unique index, ruling 3).
   */
  async unbindSessionElsewhere(userId: string, sessionId: string, keepConversationId: string): Promise<string[]> {
    const rows = await withUser(this.tenantDb, userId, (tx) =>
      tx
        .update(copilotConversations)
        .set({ onboardingSessionId: null })
        .where(
          and(
            eq(copilotConversations.userId, userId),
            eq(copilotConversations.onboardingSessionId, sessionId),
            ne(copilotConversations.id, keepConversationId),
          ),
        )
        .returning({ id: copilotConversations.id }),
    );
    return rows.map((row) => row.id);
  }

  /** The conversation's last `limit` messages, oldest first. */
  async recentMessages(userId: string, conversationId: string, limit: number): Promise<CopilotMessageDto[]> {
    const rows = await withUser(this.tenantDb, userId, (tx) =>
      tx
        .select()
        .from(copilotMessages)
        .where(eq(copilotMessages.conversationId, conversationId))
        .orderBy(desc(copilotMessages.createdAt))
        .limit(limit),
    );
    return rows.reverse().map(toMessage);
  }

  /**
   * `F3.85` PR 7 — stores one turn's messages in the order given, in one
   * `withUser` transaction, and moves the conversation's `last_turn_at`.
   *
   * Each row is its own `INSERT` with `created_at = clock_timestamp()`, set
   * explicitly: the column default `now()` is fixed at transaction start, so
   * the user's message and the reply would tie and `get` (whose tie-breaker
   * is the random `id`) could read them back reversed.
   * `copilot-history.rls.integration.spec.ts` pins the order on a real database.
   *
   * `F4.292`: the closing update also sets the title from this turn's first
   * user line (`conversationTitleOf`) when the conversation has none. The
   * first title wins; a later turn never overwrites it. No backfill (ruling P6).
   */
  async appendTurn(
    userId: string,
    conversationId: string,
    messages: ReadonlyArray<{ role: CopilotMessageDto["role"]; content: string; organizationIds: readonly string[] }>,
  ): Promise<CopilotMessageDto[]> {
    return withUser(this.tenantDb, userId, async (tx) => {
      const stored: CopilotMessageDto[] = [];
      for (const message of messages) {
        const [row] = await tx
          .insert(copilotMessages)
          .values({
            conversationId,
            userId,
            role: message.role,
            content: message.content,
            organizationIds: [...message.organizationIds],
            createdAt: sql`clock_timestamp()`,
          })
          .returning();
        if (!row) throw new Error("F3.85: a copilot message was not stored");
        stored.push(toMessage(row));
      }
      await tx
        .update(copilotConversations)
        .set({
          lastTurnAt: sql`clock_timestamp()`,
          title: sql`coalesce(${copilotConversations.title}, ${conversationTitleOf(messages)})`,
        })
        .where(and(eq(copilotConversations.id, conversationId), eq(copilotConversations.userId, userId)));
      return stored;
    });
  }
}
