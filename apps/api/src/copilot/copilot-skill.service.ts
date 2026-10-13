import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type { CopilotSkillStateDto, JwtPayload } from "@bms/shared";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { COPILOT_UNAVAILABLE_MESSAGE } from "./copilot-access.guard";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { discardOnboardingCommitCards } from "./copilot-onboarding-commit";
import {
  COPILOT_ONBOARDING_SKILL,
  COPILOT_SKILL_ALREADY_BOUND,
  COPILOT_SKILL_ORGANIZATION_MISMATCH,
  type CopilotOnboardingSkill,
  skillStateOf,
  skillStateOfSession,
} from "./copilot-onboarding-skill";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — starting, ending and reading the
 * onboarding skill of one of the caller's conversations. The routes are
 * `POST` / `DELETE /copilot/conversations/:id/skills/onboarding`; the skill's
 * turns run in `CopilotTurnService`.
 *
 * **The start's order, so a refused start leaves no draft session behind** (one
 * exception: two starts racing — the loser's session is created before its bind
 * fails, and stays a draft the onboarding page can resume):
 * the conversation is the caller's (404) and bound to the body's organization
 * (400; a cross-organization conversation never runs it) → the copilot is
 * available there (403, ruling Q4) → no skill is bound yet (409) →
 * `createSession`, whose `assertOnboardingAccess` is the skill's role gate
 * (403 for a location or asset-group administrator) → the bind, only while
 * none is bound (409 when another start won the race).
 */
@Injectable()
export class CopilotSkillService {
  constructor(
    private readonly conversations: CopilotConversationsService,
    private readonly availability: CopilotAvailabilityService,
    @Inject(COPILOT_ONBOARDING_SKILL) private readonly onboarding: CopilotOnboardingSkill,
    private readonly pending: CopilotPendingChangesService,
  ) {}

  async start(
    identity: ResolvedIdentity,
    user: JwtPayload,
    conversationId: string,
    organizationId: string,
  ): Promise<CopilotSkillStateDto> {
    const conversation = await this.conversations.findConversation(identity.id, conversationId);
    if (!conversation) throw new NotFoundException("Conversation not found");
    if (conversation.organizationId === null || conversation.organizationId !== organizationId) {
      throw new BadRequestException(COPILOT_SKILL_ORGANIZATION_MISMATCH);
    }
    const decision = await this.availability.decide(identity, organizationId);
    if (!decision.available) throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
    if (conversation.onboardingSessionId !== null) throw new ConflictException(COPILOT_SKILL_ALREADY_BOUND);

    const opening = await this.onboarding.createSession(user, organizationId);
    if (!(await this.conversations.bindOnboardingSession(identity.id, conversationId, opening.session.id))) {
      throw new ConflictException(COPILOT_SKILL_ALREADY_BOUND);
    }
    // The onboarding's opening line, so the conversation reads as it ran; it names the organization. An `action`
    // row: the onboarding wrote it, so a later plain turn replays it as a record, not as the model's words.
    await this.conversations.appendTurn(identity.id, conversationId, [
      { role: "action", content: opening.assistantMessage, organizationIds: [organizationId] },
    ]);
    return skillStateOf(opening.session.id, opening);
  }

  /**
   * Ends the skill; the session stays a draft the onboarding page can resume. Idempotent.
   * `F3.86` PR 6 review: an open `onboarding.commit` card goes with it — it commits a skill that no longer
   * runs here, and the one open change it holds would block every later proposal in the conversation.
   */
  async end(identity: ResolvedIdentity, conversationId: string): Promise<void> {
    const conversation = await this.conversations.findConversation(identity.id, conversationId);
    if (!conversation) throw new NotFoundException("Conversation not found");
    await this.conversations.unbindOnboardingSession(identity.id, conversationId);
    await discardOnboardingCommitCards(this.pending, identity.id, conversationId);
  }

  /**
   * The bound session's state for a conversation read, or `null` when none is
   * bound — and when the session can no longer be read by this caller (the
   * role changed, the session is gone): the conversation stays readable.
   */
  async stateOf(user: JwtPayload, sessionId: string | null): Promise<CopilotSkillStateDto | null> {
    if (sessionId === null) return null;
    try {
      return skillStateOfSession(await this.onboarding.getSession(user, sessionId));
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) return null;
      throw err;
    }
  }
}
