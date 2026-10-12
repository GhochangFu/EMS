import { BadRequestException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { CopilotSkillStateDto, JwtPayload } from "@bms/shared";

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
const STATE = { kind: "onboarding", sessionId: SESSION } as unknown as CopilotSkillStateDto;

function routes(boundSessionId: string | null) {
  const record = { stateOf: [] as Array<[JwtPayload, string | null]>, start: [] as unknown[][], end: 0 };
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
  const pending = { sweepStuck: async () => undefined, listOpen: async () => [] };
  const skills = {
    stateOf: async (user: JwtPayload, sessionId: string | null) => {
      record.stateOf.push([user, sessionId]);
      return STATE;
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
  const detail = await h.controller.get(CONVERSATION, ORG_ADMIN, JWT);
  expect(detail.skill).toEqual(STATE);
  expect(h.record.stateOf).toEqual([[JWT, SESSION]]);
  // The internal column never leaves: the DTO is strict.
  expect("onboardingSessionId" in detail).toBe(false);
}

/** A plain conversation's read carries no `skill` key and reads no session. */
export async function aPlainConversationReadCarriesNoSkill(): Promise<void> {
  const h = routes(null);
  const detail = await h.controller.get(CONVERSATION, ORG_ADMIN, JWT);
  expect("skill" in detail).toBe(false);
  expect(h.record.stateOf).toEqual([]);
}

/** The start parses the body, hands the caller and the organization over, and answers with the skill. */
export async function theStartRouteAnswersTheConversationWithTheSkill(): Promise<void> {
  const h = routes(null);
  const detail = await h.controller.startOnboarding(CONVERSATION, { organizationId: ORG_X }, ORG_ADMIN, JWT);
  expect(h.record.start).toEqual([[ORG_ADMIN, JWT, CONVERSATION, ORG_X]]);
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
