import type { JwtPayload } from "@bms/shared";

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
