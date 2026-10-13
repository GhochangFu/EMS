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
  COPILOT_SKILL_DRAFT_CLOSED,
  COPILOT_SKILL_ORGANIZATION_MISMATCH,
  COPILOT_SKILL_RESUMED_LINE,
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
 * fails, and stays an empty draft that the dock lists for a resume and the
 * 30-day purge erases, `F4.255` / ADR 0099 Amendment 2 A3):
 * the conversation is the caller's (404) and bound to the body's organization
 * (400; a cross-organization conversation never runs it) → the copilot is
 * available there (403, ruling Q4) → no skill is bound yet (409) →
 * `createSession`, whose `assertOnboardingAccess` is the skill's role gate
 * (403 for a location or asset-group administrator) → the bind, only while
 * none is bound (409 when another start won the race).
 *
 * **A resume** (`F4.255`, Amendment 2 A1) is a start with `sessionId`: the same
 * four checks, then `resume` reads, checks and binds the named draft instead of
 * creating one, and only after the bind frees the caller's other conversations
 * from it — so a resume that loses its bind changes nothing.
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
    sessionId?: string,
  ): Promise<CopilotSkillStateDto> {
    const conversation = await this.conversations.findConversation(identity.id, conversationId);
    if (!conversation) throw new NotFoundException("Conversation not found");
    if (conversation.organizationId === null || conversation.organizationId !== organizationId) {
      throw new BadRequestException(COPILOT_SKILL_ORGANIZATION_MISMATCH);
    }
    const decision = await this.availability.decide(identity, organizationId);
    if (!decision.available) throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
    if (conversation.onboardingSessionId !== null) throw new ConflictException(COPILOT_SKILL_ALREADY_BOUND);
    if (sessionId !== undefined) return this.resume(identity, user, conversationId, organizationId, sessionId);

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
   * `F4.255` (ADR 0099 Amendment 2 A1) — binds an existing draft after the
   * start's four checks. The read is `getSession`: its role gate and scope are
   * `loadSession`'s, so an unknown id and one outside the caller's scope are the
   * same 404 (`F4.256`), and it propagates. Then the session's organization must
   * be the conversation's (400 — reachable only by the global administrator), it
   * must still be a draft (409), and the bind runs. **Bind first:** a lost bind
   * is a 409 that changes nothing — no session was created and no other
   * conversation was freed. Only then are the caller's **own** other
   * conversations freed from the session (the per-user policy shows no one
   * else's; `ne(id, keep)` spares the row just bound, and with no unique index
   * the short double binding between the two writes is harmless), and each
   * freed conversation's open `onboarding.commit` card is discarded, as `end`
   * discards its own: it commits a skill that no longer runs there.
   */
  private async resume(
    identity: ResolvedIdentity,
    user: JwtPayload,
    conversationId: string,
    organizationId: string,
    sessionId: string,
  ): Promise<CopilotSkillStateDto> {
    const session = await this.onboarding.getSession(user, sessionId);
    if (session.organizationId !== organizationId) throw new BadRequestException(COPILOT_SKILL_ORGANIZATION_MISMATCH);
    if (session.status !== "draft") throw new ConflictException(COPILOT_SKILL_DRAFT_CLOSED);
    if (!(await this.conversations.bindOnboardingSession(identity.id, conversationId, sessionId))) {
      throw new ConflictException(COPILOT_SKILL_ALREADY_BOUND);
    }
    const freed = await this.conversations.unbindSessionElsewhere(identity.id, sessionId, conversationId);
    for (const freedConversationId of freed) {
      await discardOnboardingCommitCards(this.pending, identity.id, freedConversationId);
    }
    // The record the conversation keeps after the skill ends, as a start keeps its opening line.
    await this.conversations.appendTurn(identity.id, conversationId, [
      { role: "action", content: COPILOT_SKILL_RESUMED_LINE(session.currentPhase), organizationIds: [organizationId] },
    ]);
    return skillStateOfSession(session);
  }

  /**
   * Ends the skill; the session stays a draft the dock lists for a resume (`F4.255`). Idempotent.
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
