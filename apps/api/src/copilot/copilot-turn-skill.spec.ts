import { ForbiddenException, HttpException } from "@nestjs/common";
import { expect } from "vitest";

import type { JwtPayload, OnboardingChatMessage, OnboardingChatResponseDto, OnboardingSessionDto } from "@bms/shared";

import { FakeLlmProvider } from "../admin/onboarding/onboarding-agent-loop.spec";
import type { FinishedChange } from "./copilot-pending-changes.service";
import { type CopilotOnboardingSkill, COPILOT_SKILL_SESSION_CLOSED_REPLY } from "./copilot-onboarding-skill";
import { COPILOT_CREDENTIAL_REFUSAL, changeOutcomeLine } from "./copilot-turn.service";
import { CHANGE_ID, CONVERSATION, harness, identity, JWT, ORG_X } from "./copilot-turn.service.spec";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — a turn of the onboarding skill. A
 * conversation bound to a draft session hands each user turn to
 * `OnboardingService.chat` through the seam, after availability (step 1) and
 * the credential refusal (step 2), **counted before `chat` (ruling Q4)** and
 * before key resolution — the onboarding's guided mode answers with no key.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

export const SESSION = "66666666-6666-4666-8666-666666666666";
const ORG_ADMIN = identity("organization_admin", ORG_X);
const OPENING: OnboardingChatMessage = { id: "o1", role: "assistant", content: "Welcome to onboarding.", createdAt: "2026-10-12T00:00:00.000Z" };

function sessionDto(status: OnboardingSessionDto["status"], messages: OnboardingChatMessage[]): OnboardingSessionDto {
  return {
    id: SESSION,
    organizationId: ORG_X,
    organizationCode: "X",
    organizationName: "Org X",
    status,
    currentPhase: "rtu",
    draft: {},
    messages,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    committedAt: null,
    result: null,
    checkpoints: [],
    draftHash: null,
  };
}

type FakeOptions = {
  status?: OnboardingSessionDto["status"];
  /** The rows `chat` adds after the opening line; a user row, an action line and the reply by default. */
  added?: (message: string) => OnboardingChatMessage[];
};

/** A recording onboarding seam: which method ran, with what; `chat` adds `added` to the session. */
export function fakeOnboarding(options: FakeOptions = {}) {
  const calls = { createSession: [] as unknown[][], getSession: [] as unknown[][], chat: [] as unknown[][] };
  const row = (role: OnboardingChatMessage["role"], content: string, n: number): OnboardingChatMessage => ({
    id: `r${n}`,
    role,
    content,
    createdAt: `2026-10-12T00:00:0${n}.000Z`,
  });
  const added =
    options.added ??
    ((message: string) => [row("user", message, 1), row("action", "Added RTU RTU-1 (mqtt)", 2), row("assistant", "Added RTU-1.", 3)]);
  const skill: CopilotOnboardingSkill = {
    createSession: async (...args) => {
      calls.createSession.push(args);
      return { assistantMessage: OPENING.content, session: sessionDto("draft", [OPENING]), suggestedReplies: ["Start"], autoOpenPreview: false };
    },
    getSession: async (...args) => {
      calls.getSession.push(args);
      return sessionDto(options.status ?? "draft", [OPENING]);
    },
    chat: async (jwt: JwtPayload, id: string, message: string, chatOptions) => {
      calls.chat.push([jwt, id, message, chatOptions]);
      const response: OnboardingChatResponseDto = {
        assistantMessage: "Added RTU-1.",
        session: sessionDto("draft", [OPENING, ...added(message)]),
        suggestedReplies: ["Add an asset"],
        readyToCommit: false,
      };
      return response;
    },
  };
  return { skill, calls };
}

function skillHarness(fake = fakeOnboarding(), options: Parameters<typeof harness>[1] = {}) {
  const llm = new FakeLlmProvider([{ kind: "final", text: "the copilot answered" }]);
  const h = harness(llm, { onboardingSessionId: SESSION, onboarding: fake.skill, ...options });
  const turn = (message: string) => h.service.turn({ identity: ORG_ADMIN, user: JWT }, CONVERSATION, message, "user");
  return { ...h, llm, fake, turn };
}

/** A skill turn is the onboarding's: `chat` once with `commitByPhrase: false`, the copilot's model never. */
export async function aSkillTurnRunsTheOnboardingChatOnce(): Promise<void> {
  const h = skillHarness();
  const response = await h.turn("Add an MQTT RTU named RTU-1");
  expect(h.fake.calls.chat).toEqual([[JWT, SESSION, "Add an MQTT RTU named RTU-1", { commitByPhrase: false }]]);
  expect(h.llm.calls).toBe(0);
  expect(response.outcome).toBe("answered");
  expect(response.reply).toBe("Added RTU-1.");
  expect(response.skill?.kind).toBe("onboarding");
  expect(response.skill?.sessionId).toBe(SESSION);
  expect(response.skill?.suggestedReplies).toEqual(["Add an asset"]);
}

/** No key resolves for the organization: the skill still answers (the onboarding's guided mode), and no key is asked for. */
export async function aSkillTurnAnswersWithNoKey(): Promise<void> {
  const h = skillHarness(fakeOnboarding(), { bound: "guided" });
  const response = await h.turn("Add an MQTT RTU named RTU-1");
  expect(response.outcome).toBe("answered");
  expect(h.fake.calls.chat).toHaveLength(1);
  expect(h.counts.resolveForOrganization).toEqual([]);
}

/** Ruling Q4: the organization's copilot switch is off — the availability refusal, and `chat` never runs. */
export async function aSkillTurnObeysTheCopilotSwitch(): Promise<void> {
  const h = skillHarness(fakeOnboarding(), { available: { [ORG_X]: false } });
  await expect(h.turn("Add an MQTT RTU named RTU-1")).rejects.toBeInstanceOf(ForbiddenException);
  expect(h.fake.calls.chat).toHaveLength(0);
  expect(h.counts.consumeTurn).toHaveLength(0);
}

/** Ruling Q4: the daily limit is reached — the 429, and `chat` never runs. */
export async function aSkillTurnObeysTheDailyLimit(): Promise<void> {
  const h = skillHarness(fakeOnboarding(), { usage: { ok: false, scope: "organization", resetsAt: "2026-10-13T00:00:00.000Z" } });
  const refused = await h.turn("Add an MQTT RTU named RTU-1").catch((err: unknown) => err);
  expect(refused).toBeInstanceOf(HttpException);
  expect((refused as HttpException).getStatus()).toBe(429);
  expect(h.fake.calls.chat).toHaveLength(0);
}

/** Ruling Q4: a skill turn is counted once, against the conversation's organization. */
export async function aSkillTurnIsCountedOnce(): Promise<void> {
  const h = skillHarness();
  await h.turn("Add an MQTT RTU named RTU-1");
  expect(h.counts.consumeTurn.map((c) => c.organizationId)).toEqual([ORG_X]);
}

/** The typed phrase goes to `chat` with `commitByPhrase: false` (the onboarding spec pins that it commits nothing). */
export async function theCommitPhraseInASkillTurnIsNotACommit(): Promise<void> {
  const h = skillHarness();
  await h.turn("confirm commit");
  expect(h.fake.calls.chat[0]?.[3]).toEqual({ commitByPhrase: false });
}

/** The stored turn: the user message, this turn's action lines, the reply — with the organization's provenance. */
export async function aSkillTurnStoresItsOwnRows(): Promise<void> {
  const h = skillHarness();
  const response = await h.turn("Add an MQTT RTU named RTU-1");
  expect(response.messages.map((m) => [m.role, m.content, m.organizationIds])).toEqual([
    ["user", "Add an MQTT RTU named RTU-1", []],
    ["action", "Added RTU RTU-1 (mqtt)", [ORG_X]],
    ["assistant", "Added RTU-1.", [ORG_X]],
  ]);
}

/** Another writer's row came first (the page, at the same time): no action line is taken as this turn's. */
export async function aSkillTurnDropsActionLinesItCannotOwn(): Promise<void> {
  const fake = fakeOnboarding({
    added: (message) => [
      { id: "p1", role: "user", content: "a turn on the page", createdAt: "2026-10-12T00:00:01.000Z" },
      { id: "p2", role: "action", content: "Added RTU OTHER (mqtt)", createdAt: "2026-10-12T00:00:02.000Z" },
      { id: "r1", role: "user", content: message, createdAt: "2026-10-12T00:00:03.000Z" },
    ],
  });
  const h = skillHarness(fake);
  const response = await h.turn("Add an MQTT RTU named RTU-1");
  expect(response.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
}

/** A committed session is terminal: a fixed reply, nothing counted, `chat` never runs, nothing stored. */
export async function aClosedSessionAnswersAFixedReply(): Promise<void> {
  const h = skillHarness(fakeOnboarding({ status: "committed" }));
  const response = await h.turn("Add an asset");
  expect(response.reply).toBe(COPILOT_SKILL_SESSION_CLOSED_REPLY);
  expect(response.skill?.session.status).toBe("committed");
  expect(h.fake.calls.chat).toHaveLength(0);
  expect(h.counts.consumeTurn).toHaveLength(0);
  expect(h.counts.appendTurn).toBe(0);
}

/** ADR 0022: the copilot's own refusal answers first, before the skill — `chat` never sees the text. */
export async function theCredentialRefusalComesBeforeTheSkill(): Promise<void> {
  const h = skillHarness();
  const response = await h.turn("password: hunter2");
  expect(response.reply).toBe(COPILOT_CREDENTIAL_REFUSAL);
  expect(h.fake.calls.getSession).toHaveLength(0);
  expect(h.fake.calls.chat).toHaveLength(0);
}

/** A confirmed change's follow-up on a skill conversation stores its outcome line only: no chat, no count. */
export async function aFollowUpOnASkillConversationStoresTheOutcomeOnly(): Promise<void> {
  const finished: FinishedChange = {
    conversationId: CONVERSATION,
    catalogId: "onboarding.commit",
    organizationId: ORG_X,
    status: "applied",
    resultStatus: 200,
    resourceId: null,
    summary: "Commit the onboarding of Org X",
  };
  const h = skillHarness(fakeOnboarding(), { finished });
  await h.service.followUp({ identity: ORG_ADMIN, user: JWT }, CHANGE_ID);
  expect(h.history.map((m) => [m.role, m.content])).toEqual([["action", changeOutcomeLine(finished)]]);
  expect(h.fake.calls.chat).toHaveLength(0);
  expect(h.counts.consumeTurn).toHaveLength(0);
}

/** A plain conversation (no session bound) never reaches the seam: the unused fake would throw. */
export async function aPlainConversationNeverReachesTheSkill(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "plain answer" }]);
  const h = harness(llm);
  const response = await h.service.turn({ identity: ORG_ADMIN, user: JWT }, CONVERSATION, "How many alarms?", "user");
  expect(response.reply).toBe("plain answer");
  expect("skill" in response).toBe(false);
}
