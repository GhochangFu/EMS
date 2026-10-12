import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { CopilotMessageDto } from "@bms/shared";

import type { CopilotOnboardingSkill } from "./copilot-onboarding-skill";
import { COPILOT_SKILL_ALREADY_BOUND, COPILOT_SKILL_ORGANIZATION_MISMATCH } from "./copilot-onboarding-skill";
import { CopilotSkillService } from "./copilot-skill.service";
import { fakeOnboarding, SESSION } from "./copilot-turn-skill.spec";
import { CONVERSATION, identity, JWT, ORG_X, ORG_Y } from "./copilot-turn.service.spec";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — starting, ending and reading the
 * onboarding skill (`CopilotSkillService`). Each refusal is checked before
 * `createSession`, so a refused start leaves no draft session; the role gate
 * is `createSession`'s own (`assertOnboardingAccess`), so its 403 propagates
 * and nothing is bound. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const ORG_ADMIN = identity("organization_admin", ORG_X);

type Row = { id: string; organizationId: string | null; onboardingSessionId: string | null };

function service(options: {
  row?: Row | null;
  available?: boolean;
  bindWins?: boolean;
  onboarding?: CopilotOnboardingSkill;
} = {}) {
  const row = options.row === undefined ? { id: CONVERSATION, organizationId: ORG_X, onboardingSessionId: null } : options.row;
  const record = { binds: [] as string[], unbinds: 0, appended: [] as Array<{ role: CopilotMessageDto["role"]; content: string }>, decided: [] as string[] };
  const conversations = {
    findConversation: async () => row,
    bindOnboardingSession: async (_userId: string, _id: string, sessionId: string) => {
      record.binds.push(sessionId);
      return options.bindWins ?? true;
    },
    unbindOnboardingSession: async () => {
      record.unbinds += 1;
    },
    appendTurn: async (_userId: string, _id: string, rows: Array<{ role: CopilotMessageDto["role"]; content: string }>) => {
      record.appended.push(...rows.map(({ role, content }) => ({ role, content })));
      return [];
    },
  };
  const availability = {
    decide: async (_who: unknown, organizationId: string) => {
      record.decided.push(organizationId);
      return options.available === false ? { available: false, reason: "organization_off" } : { available: true };
    },
  };
  const fake = fakeOnboarding();
  const skills = new CopilotSkillService(conversations as never, availability as never, options.onboarding ?? fake.skill);
  return { skills, record, calls: fake.calls };
}

/** The start binds a new session, stores its opening line and answers its state. */
export async function aStartCreatesAndBindsASession(): Promise<void> {
  const h = service();
  const skill = await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X);
  expect(h.calls.createSession).toEqual([[JWT, ORG_X]]);
  expect(h.record.binds).toEqual([SESSION]);
  expect(h.record.appended).toEqual([{ role: "assistant", content: "Welcome to onboarding." }]);
  expect(skill).toMatchObject({ kind: "onboarding", sessionId: SESSION, suggestedReplies: ["Start"] });
}

/** The role gate is the onboarding's: a location administrator's 403 propagates, and nothing is bound or stored. */
export async function aLocationAdminIsRefusedByTheOnboardingGate(): Promise<void> {
  const refusing: CopilotOnboardingSkill = {
    ...fakeOnboarding().skill,
    createSession: async () => {
      throw new ForbiddenException("Not allowed to onboard this organization");
    },
  };
  const h = service({ onboarding: refusing });
  await expect(h.skills.start(identity("location_admin", ORG_X), JWT, CONVERSATION, ORG_X)).rejects.toBeInstanceOf(ForbiddenException);
  expect(h.record.binds).toEqual([]);
  expect(h.record.appended).toEqual([]);
}

/** A cross-organization conversation never runs the skill: 400 before any session. */
export async function aCrossOrganizationConversationIsRefused(): Promise<void> {
  const h = service({ row: { id: CONVERSATION, organizationId: null, onboardingSessionId: null } });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X)).rejects.toThrow(
    new BadRequestException(COPILOT_SKILL_ORGANIZATION_MISMATCH),
  );
  expect(h.calls.createSession).toEqual([]);
}

/** The body names another organization than the conversation's: 400 before any session. */
export async function anotherOrganizationIsRefused(): Promise<void> {
  const h = service();
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_Y)).rejects.toBeInstanceOf(BadRequestException);
  expect(h.calls.createSession).toEqual([]);
}

/** Ruling Q4: the copilot is off in the organization — 403 before any session. */
export async function anUnavailableCopilotRefusesTheStart(): Promise<void> {
  const h = service({ available: false });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X)).rejects.toBeInstanceOf(ForbiddenException);
  expect(h.record.decided).toEqual([ORG_X]);
  expect(h.calls.createSession).toEqual([]);
}

/** A conversation that already runs the skill: 409 before any session. */
export async function aBoundConversationRefusesASecondStart(): Promise<void> {
  const h = service({ row: { id: CONVERSATION, organizationId: ORG_X, onboardingSessionId: SESSION } });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X)).rejects.toThrow(new ConflictException(COPILOT_SKILL_ALREADY_BOUND));
  expect(h.calls.createSession).toEqual([]);
}

/** Another start won the race between the read and the bind: 409, and no opening line is stored. */
export async function aLostBindRaceIsA409(): Promise<void> {
  const h = service({ bindWins: false });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X)).rejects.toBeInstanceOf(ConflictException);
  expect(h.record.appended).toEqual([]);
}

/** Another user's conversation (the policy hides it) is a 404, for the start and the end. */
export async function anotherUsersConversationIsA404(): Promise<void> {
  const h = service({ row: null });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X)).rejects.toBeInstanceOf(NotFoundException);
  await expect(h.skills.end(ORG_ADMIN, CONVERSATION)).rejects.toBeInstanceOf(NotFoundException);
  expect(h.record.unbinds).toBe(0);
}

/** The end unbinds; the session is left alone. */
export async function anEndUnbinds(): Promise<void> {
  const h = service({ row: { id: CONVERSATION, organizationId: ORG_X, onboardingSessionId: SESSION } });
  await h.skills.end(ORG_ADMIN, CONVERSATION);
  expect(h.record.unbinds).toBe(1);
  expect(h.calls.getSession).toEqual([]);
}

/** A read: the bound session's state; `null` with none bound, and when the caller can no longer read it. */
export async function aReadOfTheSkillToleratesALostSession(): Promise<void> {
  const h = service();
  expect(await h.skills.stateOf(JWT, null)).toBeNull();
  expect((await h.skills.stateOf(JWT, SESSION))?.sessionId).toBe(SESSION);
  const gone: CopilotOnboardingSkill = {
    ...fakeOnboarding().skill,
    getSession: async () => {
      throw new ForbiddenException("Not allowed");
    },
  };
  expect(await service({ onboarding: gone }).skills.stateOf(JWT, SESSION)).toBeNull();
  const broken: CopilotOnboardingSkill = {
    ...fakeOnboarding().skill,
    getSession: async () => {
      throw new Error("database down");
    },
  };
  await expect(service({ onboarding: broken }).skills.stateOf(JWT, SESSION)).rejects.toThrow("database down");
}
