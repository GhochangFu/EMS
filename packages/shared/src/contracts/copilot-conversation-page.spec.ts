import { expect } from "vitest";

import {
  COPILOT_CONVERSATION_PAGE_MAX,
  copilotConversationDetailDtoSchema,
  copilotConversationDetailQuerySchema,
  copilotConversationListDtoSchema,
} from "./copilot";

/**
 * `F4.292` (ADR 0099 Amendment 9 E7) — the paged detail read's contracts: the
 * `?before=&limit=` query and the additive `hasEarlier` on the detail. Vitest
 * entry point: the sibling `.test.ts` (ADR 0014).
 */

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";

const DETAIL = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: null,
  title: null,
  createdAt: "2026-10-27T00:00:00.000Z",
  lastTurnAt: "2026-10-27T00:00:00.000Z",
  messages: [],
  pendingChanges: [],
};

/** `limit` arrives as a query string and parses to a number. */
export function aStringLimitParsesToANumber(): void {
  expect(copilotConversationDetailQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
}

/** A limit of 0 is refused. Mutation: `min(0)` → red. */
export function aZeroLimitIsRefused(): void {
  expect(copilotConversationDetailQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
}

/** A limit one over the cap is refused, and the cap itself is accepted. Mutation: `max(201)` → red. */
export function aLimitOverTheCapIsRefused(): void {
  expect(COPILOT_CONVERSATION_PAGE_MAX).toBe(200);
  expect(copilotConversationDetailQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  expect(copilotConversationDetailQuerySchema.safeParse({ limit: "200" }).success).toBe(true);
}

/** A `before` that is not a uuid is refused; a uuid is kept. */
export function aNonUuidCursorIsRefused(): void {
  expect(copilotConversationDetailQuerySchema.safeParse({ before: "x" }).success).toBe(false);
  expect(copilotConversationDetailQuerySchema.parse({ before: MESSAGE_ID })).toEqual({ before: MESSAGE_ID });
}

/** An unknown query key is refused (strict). */
export function anUnknownQueryKeyIsRefused(): void {
  expect(copilotConversationDetailQuerySchema.safeParse({ extra: "1" }).success).toBe(false);
}

/** A paged detail carries `hasEarlier`. */
export function aPagedDetailCarriesHasEarlier(): void {
  expect(copilotConversationDetailDtoSchema.parse({ ...DETAIL, hasEarlier: true }).hasEarlier).toBe(true);
}

/** A detail without `hasEarlier` still parses (the old shape). Mutation: drop `.optional()` → red. */
export function theOldDetailShapeStillParses(): void {
  expect(copilotConversationDetailDtoSchema.safeParse(DETAIL).success).toBe(true);
}

/** The list schema parses an array of conversations and refuses a stray key on a row. */
export function theListSchemaParsesConversations(): void {
  const row = { id: "c1", organizationId: null, title: "Show PHE alarms", createdAt: "x", lastTurnAt: "y" };
  expect(copilotConversationListDtoSchema.parse([row])).toEqual([row]);
  expect(copilotConversationListDtoSchema.safeParse([{ ...row, extra: 1 }]).success).toBe(false);
}
