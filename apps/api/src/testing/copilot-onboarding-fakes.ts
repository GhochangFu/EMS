import type { CopilotPendingChangeDto, JwtPayload } from "@bms/shared";

import type { OnboardingCommitReader } from "../copilot/copilot-onboarding-commit";
import type { CopilotOnboardingSkill } from "../copilot/copilot-onboarding-skill";
import type { CopilotSkillService } from "../copilot/copilot-skill.service";

/**
 * `F3.86` PR 5 — the onboarding skill seam for a spec whose conversations bind
 * no session: any call is a test error, so a spec that reaches the skill by
 * mistake fails loudly instead of answering.
 */
const refuse = (): never => {
  throw new Error("F3.86: this spec binds no onboarding session");
};

export const UNUSED_ONBOARDING_SKILL: CopilotOnboardingSkill = {
  createSession: refuse,
  getSession: refuse,
  chat: refuse,
};

/**
 * `F3.86` PR 6 — the stored commit proposal's reader for a spec that reaches
 * no proposal: a skill turn whose session has no draft hash never reads it.
 */
export const UNUSED_COMMIT_READER: OnboardingCommitReader = { storedProposal: refuse };

/** The skill routes' service for a controller spec that starts no skill. */
export const UNUSED_SKILL_SERVICE = { start: refuse, end: refuse, stateOf: refuse } as unknown as CopilotSkillService;

/** The token a controller spec hands the routes that read the caller's JWT (the skill reads it; none is bound). */
export const SPEC_JWT = { sub: "spec-user", email: "spec@x.test", role: "admin" } as JwtPayload;

/** The id of {@link OPEN_COMMIT_CARD}, and of {@link OPEN_OTHER_CARD} beside it. */
export const OPEN_COMMIT_ID = "a1111111-1111-4111-8111-111111111111";
export const OPEN_OTHER_ID = "a2222222-2222-4222-8222-222222222222";

function openCard(id: string, catalogId: string): CopilotPendingChangeDto {
  return {
    id,
    catalogId,
    method: "POST",
    path: "/api/v1/spec",
    body: {},
    summary: catalogId,
    risk: "create",
    proposedAt: "2026-10-12T00:00:00.000Z",
    expiresAt: "2026-10-12T00:15:00.000Z",
  };
}

/**
 * `F3.86` PR 6 review — an open `onboarding.commit` card and another open
 * change: a spec that discards the dead commit card shows the other survives.
 */
export const OPEN_COMMIT_CARD = openCard(OPEN_COMMIT_ID, "onboarding.commit");
export const OPEN_OTHER_CARD = openCard(OPEN_OTHER_ID, "dashboard.update");
