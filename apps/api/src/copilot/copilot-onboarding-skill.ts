import type { CopilotSkillStateDto, JwtPayload, OnboardingChatResponseDto, OnboardingSessionDto } from "@bms/shared";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — the onboarding skill's seam: the three
 * `OnboardingService` methods the copilot calls, and nothing else. Bound to
 * `OnboardingService` with `useExisting` (`copilot.module.ts`), so the skill
 * runs the onboarding agent, its guided mode, its role gate
 * (`assertOnboardingAccess`: admin and organization_admin), its credential
 * refusal and its checkpoints — called, never copied.
 */
export interface CopilotOnboardingSkill {
  createSession(jwt: JwtPayload, organizationId: string): Promise<OnboardingChatResponseDto>;
  getSession(jwt: JwtPayload, sessionId: string): Promise<OnboardingSessionDto>;
  chat(
    jwt: JwtPayload,
    sessionId: string,
    message: string,
  ): Promise<OnboardingChatResponseDto>;
}

export const COPILOT_ONBOARDING_SKILL = Symbol("COPILOT_ONBOARDING_SKILL");

/** The skill turn's answer when the bound session is no longer a draft: nothing is counted or sent. */
export const COPILOT_SKILL_SESSION_CLOSED_REPLY =
  "This onboarding is no longer a draft. End the onboarding in this conversation to start another.";

/** The skill turn's answer when the caller can no longer read the session: the skill ends, nothing is counted. */
export const COPILOT_SKILL_SESSION_LOST_REPLY =
  "This onboarding is no longer available to you here, so it has ended in this conversation. Ask again to continue without it.";

/** A second start on a conversation that already runs the skill (409). */
export const COPILOT_SKILL_ALREADY_BOUND = "This conversation already runs an onboarding.";

/** The start route's organization must be the conversation's own (400). */
export const COPILOT_SKILL_ORGANIZATION_MISMATCH =
  "The onboarding runs in the organization this conversation is bound to.";

/** The skill state the dock renders, from an onboarding chat answer. */
export function skillStateOf(sessionId: string, answer: OnboardingChatResponseDto): CopilotSkillStateDto {
  return {
    kind: "onboarding",
    sessionId,
    session: answer.session,
    suggestedReplies: answer.suggestedReplies,
    validationErrors: answer.validationErrors,
    readyToCommit: answer.readyToCommit,
    autoOpenPreview: answer.autoOpenPreview,
    autoOpenReason: answer.autoOpenReason,
  };
}

/** The skill state from a session read alone (a reload): no chat answer, so no chips or validation. */
export function skillStateOfSession(session: OnboardingSessionDto): CopilotSkillStateDto {
  return { kind: "onboarding", sessionId: session.id, session };
}
