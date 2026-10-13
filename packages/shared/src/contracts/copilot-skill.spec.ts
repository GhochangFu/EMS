import { expect } from "vitest";

import {
  copilotConversationDetailDtoSchema,
  copilotSkillStateDtoSchema,
  copilotStartOnboardingSkillBodySchema,
  copilotTurnResponseDtoSchema,
} from "./copilot";
import { commitOnboardingBodySchema } from "./onboarding";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — the onboarding skill's contracts: the
 * skill state the dock reads, the route body that starts it, and the commit
 * route's required `draftHash`. Vitest entry point: the sibling `.test.ts`
 * (ADR 0014).
 */

const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  organizationCode: "ORG",
  organizationName: "Org",
  status: "draft",
  currentPhase: "rtu",
  draft: {},
  messages: [],
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
  committedAt: null,
  result: null,
  checkpoints: [],
  draftHash: null,
};

const SKILL = { kind: "onboarding", sessionId: SESSION.id, session: SESSION, suggestedReplies: ["View draft"] };

/** A 64-character hash binds the commit; an empty body, a short hash or another key is refused. */
export function theCommitBodyRequiresTheHash(): void {
  expect(commitOnboardingBodySchema.safeParse({}).success).toBe(false);
  expect(commitOnboardingBodySchema.parse({ draftHash: "a".repeat(64) })).toEqual({ draftHash: "a".repeat(64) });
  expect(commitOnboardingBodySchema.safeParse({ draftHash: "a".repeat(63) }).success).toBe(false);
  expect(commitOnboardingBodySchema.safeParse({ draftHash: "a".repeat(64), force: true }).success).toBe(false);
}

/** The skill state carries the session and the chat answer's members; another kind is refused. */
export function theSkillStateParsesTheOnboardingShape(): void {
  const parsed = copilotSkillStateDtoSchema.parse(SKILL);
  expect(parsed.session.id).toBe(SESSION.id);
  expect(parsed.suggestedReplies).toEqual(["View draft"]);
  expect(copilotSkillStateDtoSchema.safeParse({ ...SKILL, kind: "dashboards" }).success).toBe(false);
  expect(copilotSkillStateDtoSchema.safeParse({ ...SKILL, extra: 1 }).success).toBe(false);
}

/** A turn and a conversation detail may carry the skill, `null`, or nothing (a pre-PR-5 answer). */
export function theTurnAndTheDetailCarryTheSkill(): void {
  const turn = {
    conversationId: "c1",
    outcome: "answered",
    configured: true,
    reply: "Hi",
    messages: [],
    navigateTo: null,
    pendingChanges: [],
    fillStep: null,
  };
  expect(copilotTurnResponseDtoSchema.parse({ ...turn, skill: SKILL }).skill?.kind).toBe("onboarding");
  expect(copilotTurnResponseDtoSchema.parse({ ...turn, skill: null }).skill).toBeNull();
  expect(copilotTurnResponseDtoSchema.parse(turn).skill).toBeUndefined();
  const detail = {
    id: "c1",
    organizationId: null,
    title: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    lastTurnAt: "2026-10-12T00:00:00.000Z",
    messages: [],
    pendingChanges: [],
  };
  expect(copilotConversationDetailDtoSchema.parse({ ...detail, skill: SKILL }).skill?.sessionId).toBe(SESSION.id);
  expect(copilotConversationDetailDtoSchema.parse(detail).skill).toBeUndefined();
}

/** The start body names one organization by uuid. */
export function theStartBodyNamesOneOrganization(): void {
  expect(copilotStartOnboardingSkillBodySchema.parse({ organizationId: SESSION.organizationId })).toEqual({
    organizationId: SESSION.organizationId,
  });
  expect(copilotStartOnboardingSkillBodySchema.safeParse({ organizationId: "ORG" }).success).toBe(false);
  expect(copilotStartOnboardingSkillBodySchema.safeParse({ organizationId: null }).success).toBe(false);
}

/** `F4.255` (ADR 0099 Amendment 2 A1): a resume body names the draft too, and the parse keeps it. */
export function theStartBodyMayNameADraftToResume(): void {
  expect(
    copilotStartOnboardingSkillBodySchema.parse({ organizationId: SESSION.organizationId, sessionId: SESSION.id }),
  ).toEqual({ organizationId: SESSION.organizationId, sessionId: SESSION.id });
}

/** `F4.255`: the draft is named by uuid; anything else is refused, so the loosening stays gated. */
export function theStartBodyRefusesANonUuidSessionId(): void {
  expect(
    copilotStartOnboardingSkillBodySchema.safeParse({ organizationId: SESSION.organizationId, sessionId: "x" }).success,
  ).toBe(false);
}

/** `F4.255`: the body stays strict — an unknown key is refused beside the new optional one. */
export function theStartBodyStaysStrict(): void {
  expect(
    copilotStartOnboardingSkillBodySchema.safeParse({ organizationId: SESSION.organizationId, draft: {} }).success,
  ).toBe(false);
}
