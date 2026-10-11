import { ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import { copilotRejectResponseDtoSchema, type CopilotMessageDto } from "@bms/shared";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { CHANGE_NOT_PENDING, CopilotChangesController } from "./copilot-changes.controller";

/**
 * `F3.85` PR 8 / ADR 0099 decision 4 — the Reject route over fakes. The
 * compare-and-set itself is SQL (`copilot-pending-changes.integration.spec.ts`).
 * Vitest entry point: the sibling `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const CHANGE = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const ME = { id: USER, role: "admin", organizationId: null } as ResolvedIdentity;

function harness(rejected: { conversationId: string | null; organizationId: string; summary: string } | null) {
  const rejects: string[] = [];
  const appended: Array<Array<{ role: string; content: string; organizationIds: readonly string[] }>> = [];
  const controller = new CopilotChangesController(
    {
      sweepStuck: async () => 0,
      reject: async (_userId: string, id: string) => {
        rejects.push(id);
        return rejected;
      },
    } as never,
    {
      appendTurn: async (_userId: string, conversationId: string, rows: Array<{ role: CopilotMessageDto["role"]; content: string; organizationIds: readonly string[] }>) => {
        appended.push(rows);
        return rows.map((row, i): CopilotMessageDto => ({
          id: `m${i}`,
          conversationId,
          role: row.role,
          content: row.content,
          organizationIds: [...row.organizationIds],
          createdAt: "2026-10-11T06:00:00.000Z",
        }));
      },
    } as never,
  );
  return { controller, rejects, appended };
}

/** A pending change is rejected and leaves one action line naming it, with its organization as provenance. */
export async function aPendingChangeIsRejectedWithAnActionLine(): Promise<void> {
  const h = harness({ conversationId: CONVERSATION, organizationId: ORG, summary: 'Archive the dashboard template "T".' });
  const response = await h.controller.reject(CHANGE, ME);
  expect(copilotRejectResponseDtoSchema.parse(response)).toEqual(response);
  expect(response).toMatchObject({ id: CHANGE, status: "rejected" });
  expect(h.rejects).toEqual([CHANGE]);
  expect(h.appended).toEqual([[{ role: "action", content: 'Rejected: Archive the dashboard template "T".', organizationIds: [ORG] }]]);
}

/** A change that is not this user's, not pending, or not found: one 409, and nothing is stored. */
export async function aChangeThatIsNotPendingIs409(): Promise<void> {
  const h = harness(null);
  await expect(h.controller.reject(CHANGE, ME)).rejects.toThrow(new ConflictException(CHANGE_NOT_PENDING));
  expect(h.appended).toEqual([]);
}

/** A malformed id never reaches the database. */
export async function aMalformedIdIs409WithoutAQuery(): Promise<void> {
  const h = harness({ conversationId: CONVERSATION, organizationId: ORG, summary: "x" });
  await expect(h.controller.reject("not-a-uuid", ME)).rejects.toBeInstanceOf(ConflictException);
  expect(h.rejects).toEqual([]);
}

/** A change whose conversation was purged is rejected with no action line. */
export async function aChangeWithoutAConversationStoresNoLine(): Promise<void> {
  const h = harness({ conversationId: null, organizationId: ORG, summary: "x" });
  expect((await h.controller.reject(CHANGE, ME)).messages).toEqual([]);
  expect(h.appended).toEqual([]);
}
