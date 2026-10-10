import { expect } from "vitest";

import { COPILOT_CONVERSATION_LIST_LIMIT, CopilotConversationsService } from "./copilot-conversations.service";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "33333333-3333-4333-8333-333333333333";
const ORG = "00000000-0000-4000-8000-00000000000b";

type Options = {
  organizations?: Array<{ id: string }>;
  conversations?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
};

/**
 * A tenant pool double. `transactions` counts `withUser` transactions;
 * `limits` records every `.limit(n)` the list query passes; `inserted` what
 * the insert receives.
 */
function dbFake(options: Options = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const listLimits: number[] = [];
  let transactions = 0;
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
      from: () => ({
        where: () => ({
          // The detail read's first step: the conversation itself.
          limit: async () => options.conversations ?? [],
          orderBy: () => {
            const ordered = Promise.resolve(options.messages ?? []);
            return Object.assign(ordered, {
              // The list query: record the bound it asks for.
              limit: async (n: number) => {
                listLimits.push(n);
                return options.conversations ?? [];
              },
            });
          },
        }),
      }),
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
