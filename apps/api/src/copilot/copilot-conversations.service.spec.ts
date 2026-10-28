import { expect } from "vitest";

import { copilotMessages } from "@bms/db";

import {
  COPILOT_CONVERSATION_LIST_LIMIT,
  conversationTitleOf,
  CopilotConversationsService,
  CopilotCursorNotFoundError,
} from "./copilot-conversations.service";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "33333333-3333-4333-8333-333333333333";
const ORG = "00000000-0000-4000-8000-00000000000b";

type Options = {
  organizations?: Array<{ id: string }>;
  conversations?: Array<Record<string, unknown>>;
  /** What the message query answers, in the order the query would (newest first on a paged read). */
  messages?: Array<Record<string, unknown>>;
  /** `F4.292`: what the cursor lookup answers (`[]`: the `before` names no message of the conversation). */
  cursor?: Array<{ id: string }>;
};

/**
 * A tenant pool double. `transactions` counts `withUser` transactions;
 * `listLimits` records every `.limit(n)` the list query passes; `inserted` what
 * the insert receives. `F4.292`: a select from `copilotMessages` takes its own
 * chain — `where → limit` is the cursor lookup, `where → orderBy → limit(n)`
 * the paged message read, whose bound `messageLimits` records.
 */
function dbFake(options: Options = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const listLimits: number[] = [];
  const messageLimits: number[] = [];
  let transactions = 0;
  const messageChain = () => ({
    where: () => ({
      limit: async () => options.cursor ?? [],
      orderBy: () =>
        Object.assign(Promise.resolve(options.messages ?? []), {
          limit: async (n: number) => {
            messageLimits.push(n);
            return options.messages ?? [];
          },
        }),
    }),
  });
  const tx = {
    execute: async () => ({ rows: [] }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          returning: async () => [{ id: "c1", title: null, createdAt: new Date(0), lastTurnAt: new Date(0), ...v }],
        };
      },
    }),
    select: () => ({
      from: (table: unknown) =>
        table === copilotMessages
          ? messageChain()
          : {
              where: () => ({
                // The detail read's first step: the conversation itself.
                limit: async () => options.conversations ?? [],
                orderBy: () => ({
                  // The list query: record the bound it asks for.
                  limit: async (n: number) => {
                    listLimits.push(n);
                    return options.conversations ?? [];
                  },
                }),
              }),
            },
    }),
  };
  const db = {
    transaction: async (fn: (t: unknown) => unknown) => {
      transactions += 1;
      return fn(tx);
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => options.organizations ?? [] }) }) }),
  };
  return {
    service: new CopilotConversationsService(db as never),
    inserted,
    listLimits,
    messageLimits,
    transactions: () => transactions,
  };
}

const conversationRow = {
  id: CONV_ID,
  userId: USER_ID,
  organizationId: ORG,
  title: "t",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  lastTurnAt: new Date("2026-10-02T00:00:00Z"),
};

/** A create inserts the caller and the binding, in one `withUser` transaction, and maps the row. */
export async function assertCreateInsertsTheCallerAndTheBinding(): Promise<void> {
  const h = dbFake();
  const dto = await h.service.create(USER_ID, ORG);
  expect(h.inserted).toEqual([{ userId: USER_ID, organizationId: ORG }]);
  expect(h.transactions()).toBe(1);
  expect(dto).toEqual({
    id: "c1",
    organizationId: ORG,
    title: null,
    createdAt: new Date(0).toISOString(),
    lastTurnAt: new Date(0).toISOString(),
  });

  const cross = dbFake();
  await cross.service.create(USER_ID, null);
  expect(cross.inserted).toEqual([{ userId: USER_ID, organizationId: null }]);
}

/** The list asks the query for exactly `COPILOT_CONVERSATION_LIST_LIMIT` rows (the stated bound). */
export async function assertTheListIsBounded(): Promise<void> {
  expect(COPILOT_CONVERSATION_LIST_LIMIT).toBe(100);
  const h = dbFake({ conversations: [conversationRow] });
  const rows = await h.service.list(USER_ID);
  expect(h.listLimits).toEqual([COPILOT_CONVERSATION_LIST_LIMIT]);
  expect(h.transactions()).toBe(1);
  expect(rows.map((r) => r.id)).toEqual([CONV_ID]);
}

/** A hidden or missing conversation is null; a visible one comes back with its messages mapped. */
export async function assertGetReturnsNullOrTheDetail(): Promise<void> {
  const hidden = dbFake({ conversations: [] });
  expect(await hidden.service.get(USER_ID, CONV_ID)).toBeNull();
  expect(hidden.transactions()).toBe(1);

  const seen = dbFake({
    conversations: [conversationRow],
    messages: [
      {
        id: "m1",
        conversationId: CONV_ID,
        role: "user",
        content: "hi",
        organizationIds: [ORG],
        createdAt: new Date("2026-10-01T00:01:00Z"),
      },
    ],
  });
  const detail = await seen.service.get(USER_ID, CONV_ID);
  expect(detail).toEqual({
    id: CONV_ID,
    organizationId: ORG,
    title: "t",
    createdAt: "2026-10-01T00:00:00.000Z",
    lastTurnAt: "2026-10-02T00:00:00.000Z",
    messages: [
      {
        id: "m1",
        conversationId: CONV_ID,
        role: "user",
        content: "hi",
        organizationIds: [ORG],
        createdAt: "2026-10-01T00:01:00.000Z",
      },
    ],
  });
}

/** `organizationExists` answers from the organization lookup. */
export async function assertOrganizationExistsReadsTheLookup(): Promise<void> {
  expect(await dbFake({ organizations: [{ id: ORG }] }).service.organizationExists(ORG)).toBe(true);
  expect(await dbFake({ organizations: [] }).service.organizationExists(ORG)).toBe(false);
}

/*
 * `F4.292` (ADR 0099 Amendment 9 E7) — the paged read. The fake answers the
 * message query newest first, as `ORDER BY created_at DESC, id DESC` would.
 * The keyset compare itself runs in SQL; the integration spec pins it.
 */
function messageRow(id: string, minute: number): Record<string, unknown> {
  return {
    id,
    conversationId: CONV_ID,
    role: "user",
    content: id,
    organizationIds: [],
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)),
  };
}

/** A paged read asks the query for one row more than the page. Mutation: `limit(page.limit)` → red. */
export async function assertAPagedReadAsksOneRowMore(): Promise<void> {
  const h = dbFake({ conversations: [conversationRow], messages: [] });
  await h.service.get(USER_ID, CONV_ID, { limit: 2 });
  expect(h.messageLimits).toEqual([3]);
}

/** One row over the page: the page holds `limit` rows, oldest first. Mutation: drop `.reverse()` → red. */
export async function assertAFullPageIsOldestFirst(): Promise<void> {
  const h = dbFake({ conversations: [conversationRow], messages: [messageRow("m5", 5), messageRow("m4", 4), messageRow("m3", 3)] });
  const page = await h.service.get(USER_ID, CONV_ID, { limit: 2 });
  expect(page?.messages.map((m) => m.id)).toEqual(["m4", "m5"]);
}

/** One row over the page: `hasEarlier` is true. Mutation: compare against `page.limit + 1` → red. */
export async function assertARowOverThePageSetsHasEarlier(): Promise<void> {
  const h = dbFake({ conversations: [conversationRow], messages: [messageRow("m5", 5), messageRow("m4", 4), messageRow("m3", 3)] });
  const page = await h.service.get(USER_ID, CONV_ID, { limit: 2 });
  expect(page?.hasEarlier).toBe(true);
}

/** Exactly `limit` rows: `hasEarlier` is false. Mutation: `>=` for `>` → red. */
export async function assertAnExactPageHasNoEarlier(): Promise<void> {
  const h = dbFake({ conversations: [conversationRow], messages: [messageRow("m5", 5), messageRow("m4", 4)] });
  const page = await h.service.get(USER_ID, CONV_ID, { limit: 2 });
  expect(page?.hasEarlier).toBe(false);
}

/** A read with no page has no `hasEarlier` key and no bound. Mutation: always spread `hasEarlier` → red. */
export async function assertAnUnpagedReadKeepsTheOldShape(): Promise<void> {
  const h = dbFake({ conversations: [conversationRow], messages: [messageRow("m1", 1)] });
  const detail = await h.service.get(USER_ID, CONV_ID);
  expect(detail).not.toBeNull();
  expect(detail && "hasEarlier" in detail).toBe(false);
  expect(h.messageLimits).toEqual([]);
}

/** A `before` the cursor lookup does not find throws `CopilotCursorNotFoundError`. Mutation: skip the lookup → red. */
export async function assertAMissingCursorThrows(): Promise<void> {
  const h = dbFake({ conversations: [conversationRow], messages: [messageRow("m1", 1)], cursor: [] });
  const err = await h.service.get(USER_ID, CONV_ID, { before: "m9", limit: 2 }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CopilotCursorNotFoundError);
  // Positive control: the same read with a found cursor answers a page.
  const found = dbFake({ conversations: [conversationRow], messages: [messageRow("m1", 1)], cursor: [{ id: "m9" }] });
  expect((await found.service.get(USER_ID, CONV_ID, { before: "m9", limit: 2 }))?.messages.map((m) => m.id)).toEqual(["m1"]);
}

/** The title is the first line of the first user message, trimmed. */
export function assertTheTitleIsTheFirstUserLine(): void {
  expect(
    conversationTitleOf([
      { role: "action", content: "Applied: x" },
      { role: "user", content: "  Show PHE alarms  \nand the rest" },
      { role: "assistant", content: "Here they are." },
    ]),
  ).toBe("Show PHE alarms");
}

/** The title is cut at 200 characters. Mutation: drop the cut → red. */
export function assertTheTitleIsCutAt200(): void {
  expect(conversationTitleOf([{ role: "user", content: "a".repeat(250) }])).toBe("a".repeat(200));
}

/** An attachment record line is skipped. Mutation: drop the `[Attachment` test → red. */
export function assertTheTitleSkipsAnAttachmentRecord(): void {
  expect(conversationTitleOf([{ role: "user", content: '[Attachment 1 of 1: "a.png", image/png]\nRead this drawing' }])).toBe(
    "Read this drawing",
  );
}

/** A blank first line is skipped (critic: `""` would stick under `coalesce`). Mutation: drop the empty-line test → red. */
export function assertTheTitleSkipsABlankLine(): void {
  expect(conversationTitleOf([{ role: "user", content: "\n   \nShow PHE alarms" }])).toBe("Show PHE alarms");
}

/** A turn with no user line titles nothing. Mutation: fall back to the first message of any role → red. */
export function assertNoUserLineTitlesNothing(): void {
  expect(conversationTitleOf([{ role: "action", content: "Onboarding started." }])).toBeNull();
  expect(conversationTitleOf([{ role: "user", content: '[Attachment 1: "a.png", image/png]' }])).toBeNull();
}
