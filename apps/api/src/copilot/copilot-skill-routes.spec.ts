import { BadRequestException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { CopilotPendingChangeDto, CopilotSkillStateDto, JwtPayload } from "@bms/shared";

import { OPEN_COMMIT_CARD, OPEN_COMMIT_ID, OPEN_OTHER_CARD } from "../testing/copilot-onboarding-fakes";

import { CopilotConversationsController } from "./copilot-conversations.controller";
import type { CopilotSkillService } from "./copilot-skill.service";
import { CONVERSATION, identity, JWT, ORG_X } from "./copilot-turn.service.spec";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — the skill on the conversation routes:
 * `GET :id` carries the bound session's state (so the dock reloads into the
 * skill), `POST :id/skills/onboarding` answers the conversation with the new
 * skill, `DELETE` answers it with `skill: null`; a plain conversation carries
 * no `skill` key. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG_ADMIN = identity("organization_admin", ORG_X);
const SESSION = "77777777-7777-4777-8777-777777777777";
const STATE = { kind: "onboarding", sessionId: SESSION, session: { status: "draft" } } as unknown as CopilotSkillStateDto;
const COMMITTED_STATE = { kind: "onboarding", sessionId: SESSION, session: { status: "committed" } } as unknown as CopilotSkillStateDto;

function routes(boundSessionId: string | null, options: { state?: CopilotSkillStateDto; open?: CopilotPendingChangeDto[] } = {}) {
  const state = options.state ?? STATE;
  const record = { stateOf: [] as Array<[JwtPayload, string | null]>, start: [] as unknown[][], end: 0, discarded: [] as string[][], listOpen: [] as Array<[string, string]>, discardUsers: [] as string[] };
  const conversations = {
    get: async (_userId: string, id: string) =>
      id === CONVERSATION
        ? {
            id,
            organizationId: ORG_X,
            title: null,
            createdAt: "2026-10-12T00:00:00.000Z",
            lastTurnAt: "2026-10-12T00:00:00.000Z",
            messages: [],
            onboardingSessionId: boundSessionId,
          }
        : null,
  };
  const pending = {
    sweepStuck: async () => undefined,
    listOpen: async (userId: string, conversationId: string) => {
      record.listOpen.push([userId, conversationId]);
      return [...(options.open ?? [])];
    },
    discard: async (userId: string, ids: readonly string[]) => {
      record.discardUsers.push(userId);
      record.discarded.push([...ids]);
    },
    latestFinished: async () => null,
  };
  const skills = {
    stateOf: async (user: JwtPayload, sessionId: string | null) => {
      record.stateOf.push([user, sessionId]);
      return state;
    },
    start: async (...args: unknown[]) => {
      record.start.push(args);
      return STATE;
    },
    end: async () => {
      record.end += 1;
    },
  } as unknown as CopilotSkillService;
  const controller = new CopilotConversationsController(conversations as never, {} as never, pending as never, {} as never, skills);
  return { controller, record };
}

/** A bound conversation's read carries the session's state, read as the caller. */
export async function aBoundConversationReadCarriesTheSkill(): Promise<void> {
  const h = routes(SESSION);
  const detail = await h.controller.get(CONVERSATION, {}, ORG_ADMIN, JWT);
  expect(detail.skill).toEqual(STATE);
  expect(h.record.stateOf).toEqual([[JWT, SESSION]]);
  // The internal column never leaves: the DTO is strict.
  expect("onboardingSessionId" in detail).toBe(false);
}

/** A plain conversation's read carries no `skill` key and reads no session. */
export async function aPlainConversationReadCarriesNoSkill(): Promise<void> {
  const h = routes(null);
  const detail = await h.controller.get(CONVERSATION, {}, ORG_ADMIN, JWT);
  expect("skill" in detail).toBe(false);
  expect(h.record.stateOf).toEqual([]);
}

/** The start parses the body, hands the caller and the organization over, and answers with the skill. */
export async function theStartRouteAnswersTheConversationWithTheSkill(): Promise<void> {
  const h = routes(null);
  const detail = await h.controller.startOnboarding(CONVERSATION, { organizationId: ORG_X }, ORG_ADMIN, JWT);
  // F4.255: a plain start passes no sessionId, so the fifth argument is undefined.
  expect(h.record.start).toEqual([[ORG_ADMIN, JWT, CONVERSATION, ORG_X, undefined]]);
  expect(detail.skill).toEqual(STATE);
}

/** A bad body is a 400 and a non-uuid id a 404; neither reaches the start. */
export async function theStartRouteRefusesABadBodyOrId(): Promise<void> {
  const h = routes(null);
  await expect(h.controller.startOnboarding(CONVERSATION, { organizationId: "X" }, ORG_ADMIN, JWT)).rejects.toBeInstanceOf(
    BadRequestException,
  );
  await expect(h.controller.startOnboarding("not-a-uuid", { organizationId: ORG_X }, ORG_ADMIN, JWT)).rejects.toBeInstanceOf(
    NotFoundException,
  );
  expect(h.record.start).toEqual([]);
}

/** The end answers the conversation with `skill: null`. */
export async function theEndRouteAnswersWithNoSkill(): Promise<void> {
  const h = routes(SESSION);
  const detail = await h.controller.endOnboarding(CONVERSATION, ORG_ADMIN);
  expect(h.record.end).toBe(1);
  expect(detail.skill).toBeNull();
}

/**
 * `F3.86` PR 6 review — the read is the point every reload passes: a session
 * committed another way (the drawer's wizard, the onboarding page) leaves its
 * commit card dead, so the read rejects it and does not show it. Another open
 * change stays, and is shown.
 */
export async function aReadOfACommittedSkillDropsItsCommitCard(): Promise<void> {
  const h = routes(SESSION, { state: COMMITTED_STATE, open: [OPEN_COMMIT_CARD, OPEN_OTHER_CARD] });
  const detail = await h.controller.get(CONVERSATION, {}, ORG_ADMIN, JWT);
  expect(h.record.discarded).toEqual([[OPEN_COMMIT_ID]]);
  expect(h.record.listOpen).toEqual([[ORG_ADMIN.id, CONVERSATION]]);
  expect(h.record.discardUsers).toEqual([ORG_ADMIN.id]);
  expect(detail.pendingChanges).toEqual([OPEN_OTHER_CARD]);
}

/** A draft skill keeps its commit card: it is live, and nothing is discarded. */
export async function aReadOfADraftSkillKeepsItsCommitCard(): Promise<void> {
  const h = routes(SESSION, { open: [OPEN_COMMIT_CARD, OPEN_OTHER_CARD] });
  const detail = await h.controller.get(CONVERSATION, {}, ORG_ADMIN, JWT);
  expect(h.record.discarded).toEqual([]);
  expect(detail.pendingChanges).toEqual([OPEN_COMMIT_CARD, OPEN_OTHER_CARD]);
}

/** A plain conversation (the skill ended) holds no live commit card: a left one is rejected, the other change shown. */
export async function aPlainReadDropsALeftCommitCard(): Promise<void> {
  const h = routes(null, { open: [OPEN_COMMIT_CARD, OPEN_OTHER_CARD] });
  const detail = await h.controller.get(CONVERSATION, {}, ORG_ADMIN, JWT);
  expect(h.record.discarded).toEqual([[OPEN_COMMIT_ID]]);
  expect(detail.pendingChanges).toEqual([OPEN_OTHER_CARD]);
}

/** `F4.255` (ADR 0099 Amendment 2 A1): a resume body's `sessionId` reaches the start as its fifth argument. */
export async function theStartRouteHandsTheSessionIdToTheResume(): Promise<void> {
  const h = routes(null);
  await h.controller.startOnboarding(CONVERSATION, { organizationId: ORG_X, sessionId: SESSION }, ORG_ADMIN, JWT);
  expect(h.record.start).toEqual([[ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION]]);
}

/** `F4.255`: a non-uuid `sessionId` is a 400 before the start. */
export async function theStartRouteRefusesANonUuidSessionId(): Promise<void> {
  const h = routes(null);
  await expect(
    h.controller.startOnboarding(CONVERSATION, { organizationId: ORG_X, sessionId: "x" }, ORG_ADMIN, JWT),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(h.record.start).toEqual([]);
}
