import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { CopilotMessageDto, OnboardingSessionDto } from "@bms/shared";

import { OPEN_COMMIT_CARD, OPEN_COMMIT_ID, OPEN_OTHER_CARD } from "../testing/copilot-onboarding-fakes";
import type { CopilotOnboardingSkill } from "./copilot-onboarding-skill";
import {
  COPILOT_SKILL_ALREADY_BOUND,
  COPILOT_SKILL_DRAFT_CLOSED,
  COPILOT_SKILL_ORGANIZATION_MISMATCH,
} from "./copilot-onboarding-skill";
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

/** `F4.255`: the caller's other conversation that a resume frees from the session. */
const OTHER_CONVERSATION = "99999999-9999-4999-8999-999999999999";

type Row = { id: string; organizationId: string | null; onboardingSessionId: string | null };

function service(options: {
  row?: Row | null;
  available?: boolean;
  bindWins?: boolean;
  onboarding?: CopilotOnboardingSkill;
  /** `F4.255`: overrides on the session the recording fake's `getSession` answers (its calls still record). */
  session?: Partial<Pick<OnboardingSessionDto, "organizationId" | "status">>;
} = {}) {
  const row = options.row === undefined ? { id: CONVERSATION, organizationId: ORG_X, onboardingSessionId: null } : options.row;
  const record = { listOpen: [] as Array<[string, string]>, discardUsers: [] as string[], discarded: [] as string[][], binds: [] as string[], unbinds: 0, unbindsElsewhere: [] as string[][], order: [] as string[], appended: [] as Array<{ role: CopilotMessageDto["role"]; content: string }>, decided: [] as string[] };
  const conversations = {
    findConversation: async () => row,
    bindOnboardingSession: async (_userId: string, _id: string, sessionId: string) => {
      record.order.push("bind");
      record.binds.push(sessionId);
      return options.bindWins ?? true;
    },
    unbindOnboardingSession: async () => {
      record.unbinds += 1;
    },
    unbindSessionElsewhere: async (userId: string, sessionId: string, keepConversationId: string) => {
      record.order.push("unbindElsewhere");
      record.unbindsElsewhere.push([userId, sessionId, keepConversationId]);
      return [OTHER_CONVERSATION];
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
  const pending = {
    listOpen: async (userId: string, conversationId: string) => {
      record.listOpen.push([userId, conversationId]);
      return [OPEN_COMMIT_CARD, OPEN_OTHER_CARD];
    },
    discard: async (userId: string, ids: readonly string[]) => {
      record.discardUsers.push(userId);
      record.discarded.push([...ids]);
    },
  };
  const fake = fakeOnboarding();
  if (options.session) {
    const read = fake.skill.getSession;
    const overrides = options.session;
    fake.skill.getSession = async (...args) => ({ ...(await read(...args)), ...overrides });
  }
  const skills = new CopilotSkillService(conversations as never, availability as never, options.onboarding ?? fake.skill, pending as never);
  return { skills, record, calls: fake.calls };
}

/** The start binds a new session, stores its opening line and answers its state. */
export async function aStartCreatesAndBindsASession(): Promise<void> {
  const h = service();
  const skill = await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X);
  expect(h.calls.createSession).toEqual([[JWT, ORG_X]]);
  expect(h.record.binds).toEqual([SESSION]);
  // The onboarding wrote the line: an action row, replayed later as a record (security review L1).
  expect(h.record.appended).toEqual([{ role: "action", content: "Welcome to onboarding." }]);
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

/**
 * `F3.86` PR 6 review — the end rejects the open `onboarding.commit` card (its
 * Confirm could only answer 400, and it would block every later proposal);
 * another open change stays.
 */
export async function anEndDiscardsTheOpenCommitCardOnly(): Promise<void> {
  const h = service({ row: { id: CONVERSATION, organizationId: ORG_X, onboardingSessionId: SESSION } });
  await h.skills.end(ORG_ADMIN, CONVERSATION);
  expect(h.record.discarded).toEqual([[OPEN_COMMIT_ID]]);
  expect(h.record.listOpen).toEqual([[ORG_ADMIN.id, CONVERSATION]]);
  expect(h.record.discardUsers).toEqual([ORG_ADMIN.id]);
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

/*
 * `F4.255` (ADR 0099 Amendment 2 A1) — a start with `sessionId` resumes that
 * draft: the same four pre-checks, then the session read (`getSession`, whose
 * role gate and `F4.256` uniform 404 are `loadSession`'s), the organization and
 * the status, the caller's own other bindings freed, the bind, and one action
 * line. No session is created on a resume.
 */

/** R1a — a resume reads the named session, binds it and answers its state; nothing is created. */
export async function aResumeBindsTheNamedDraft(): Promise<void> {
  const h = service();
  const skill = await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION);
  expect(h.calls.getSession).toEqual([[JWT, SESSION]]);
  expect(h.record.binds).toEqual([SESSION]);
  expect(skill).toMatchObject({ kind: "onboarding", sessionId: SESSION });
  expect(h.calls.createSession).toEqual([]);
}

/** R1b — a resume frees the caller's own other conversations from the session, keeping this one. */
export async function aResumeUnbindsTheCallersOtherConversations(): Promise<void> {
  const h = service();
  await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION);
  expect(h.record.unbindsElsewhere).toEqual([[ORG_ADMIN.id, SESSION, CONVERSATION]]);
}

/**
 * R1c — a resume stores one action line naming the phase by its display name
 * (`STEP_NAMES`), as a start stores its opening line. The literal, not
 * `COPILOT_SKILL_RESUMED_LINE("rtu")`: a self-referential expectation stays
 * green when the line drops the display name.
 */
export async function aResumeRecordsTheResumedLine(): Promise<void> {
  const h = service();
  await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION);
  expect(h.record.appended).toEqual([{ role: "action", content: "Resumed an onboarding draft at the RTU step." }]);
}

/** R2a — ruling Q4 on a resume: the copilot is off, 403 before the session read. */
export async function anUnavailableCopilotRefusesAResumeBeforeTheRead(): Promise<void> {
  const h = service({ available: false });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toBeInstanceOf(ForbiddenException);
  expect(h.calls.getSession).toEqual([]);
}

/** R2b — a conversation that already runs the skill: 409 before the session read. */
export async function aBoundConversationRefusesAResumeBeforeTheRead(): Promise<void> {
  const h = service({ row: { id: CONVERSATION, organizationId: ORG_X, onboardingSessionId: SESSION } });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toThrow(
    new ConflictException(COPILOT_SKILL_ALREADY_BOUND),
  );
  expect(h.calls.getSession).toEqual([]);
}

/** R3 — the read's 404 (unknown, or out of scope since `F4.256`) propagates; nothing is unbound, bound or stored. */
export async function anUnreadableSessionPropagatesItsAnswer(): Promise<void> {
  const missing: CopilotOnboardingSkill = {
    ...fakeOnboarding().skill,
    getSession: async () => {
      throw new NotFoundException("Onboarding session not found");
    },
  };
  const h = service({ onboarding: missing });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toThrow(
    new NotFoundException("Onboarding session not found"),
  );
  expect(h.record.order).toEqual([]);
  expect(h.record.appended).toEqual([]);
}

/** R4 — a session of another organization than the conversation's: 400 with the mismatch sentence, nothing bound. */
export async function aSessionOfAnotherOrganizationIsRefused(): Promise<void> {
  const h = service({ session: { organizationId: ORG_Y } });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toThrow(
    new BadRequestException(COPILOT_SKILL_ORGANIZATION_MISMATCH),
  );
  expect(h.record.order).toEqual([]);
}

/** R5 — a session that is no longer a draft: 409 with the closed sentence, nothing bound. */
export async function aCommittedSessionCannotBeResumed(): Promise<void> {
  const h = service({ session: { status: "committed" } });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toThrow(
    new ConflictException(COPILOT_SKILL_DRAFT_CLOSED),
  );
  expect(h.record.order).toEqual([]);
}

/** R6 — a lost bind on a resume is a 409; nothing was created, and no line is stored. */
export async function aLostBindOnAResumeIsA409(): Promise<void> {
  const h = service({ bindWins: false });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toThrow(
    new ConflictException(COPILOT_SKILL_ALREADY_BOUND),
  );
  expect(h.calls.createSession).toEqual([]);
  expect(h.record.appended).toEqual([]);
}

/** R7 — the caller's other bindings are freed only after this conversation binds the session. */
export async function aResumeUnbindsElsewhereAfterItBinds(): Promise<void> {
  const h = service();
  await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION);
  expect(h.record.order).toEqual(["bind", "unbindElsewhere"]);
}

/** R7b — a resume that loses its bind frees no other conversation. */
export async function aLostBindOnAResumeFreesNothing(): Promise<void> {
  const h = service({ bindWins: false });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toBeInstanceOf(ConflictException);
  expect(h.record.unbindsElsewhere).toEqual([]);
}

/** R7c — a resume that loses its bind reads and discards no commit card. */
export async function aLostBindOnAResumeDiscardsNothing(): Promise<void> {
  const h = service({ bindWins: false });
  await expect(h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION)).rejects.toBeInstanceOf(ConflictException);
  expect(h.record.listOpen).toEqual([]);
  expect(h.record.discarded).toEqual([]);
}

/** R8a — a freed conversation's open `onboarding.commit` card is discarded at resume time, and only it. */
export async function aResumeDiscardsTheFreedConversationsCommitCard(): Promise<void> {
  const h = service();
  await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION);
  expect(h.record.discarded).toEqual([[OPEN_COMMIT_ID]]);
  expect(h.record.discardUsers).toEqual([ORG_ADMIN.id]);
}

/** R8b — the cards read are the freed conversation's, never the resumed one's. */
export async function aResumeReadsTheFreedConversationsCards(): Promise<void> {
  const h = service();
  await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X, SESSION);
  expect(h.record.listOpen).toEqual([[ORG_ADMIN.id, OTHER_CONVERSATION]]);
}

/** The control: a start with no `sessionId` creates a session and frees nothing elsewhere. */
export async function aStartWithoutASessionIdUnbindsNothingElsewhere(): Promise<void> {
  const h = service();
  await h.skills.start(ORG_ADMIN, JWT, CONVERSATION, ORG_X);
  expect(h.calls.createSession).toEqual([[JWT, ORG_X]]);
  expect(h.record.unbindsElsewhere).toEqual([]);
}
