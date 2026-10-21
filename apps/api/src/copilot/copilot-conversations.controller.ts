import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ZodError } from "zod";

import {
  COPILOT_ATTACHMENTS_MAX,
  type CopilotConversationDetailDto,
  type CopilotConversationDto,
  copilotCreateConversationBodySchema,
  type CopilotSkillStateDto,
  type CopilotStartOnboardingSkillBody,
  copilotStartOnboardingSkillBodySchema,
  type CopilotTurnBody,
  copilotTurnBodySchema,
  type CopilotTurnResponseDto,
  type JwtPayload,
  MAX_COPILOT_ATTACHMENT_BYTES,
} from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { COPILOT_UNAVAILABLE_MESSAGE, CopilotAccessGuard, CopilotIdentity } from "./copilot-access.guard";
import type { UploadedAttachment } from "./copilot-attachments";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { liveOpenChanges } from "./copilot-onboarding-commit";
import { checkOpenWizards, parseWizardsField } from "./copilot-open-wizards";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { CopilotSkillService } from "./copilot-skill.service";
import { CopilotTurnService } from "./copilot-turn.service";

/**
 * The caller's saved conversations (`F3.85` PR 5, ADR 0099 decision 8). The
 * controller is thin (AGENTS.md section 4.3): it sweeps, parses the body,
 * applies the binding rule and maps to HTTP errors; `CopilotConversationsService`
 * runs every query in `withUser`, so the `user_isolation` policy hides
 * another user's rows: their id is a 404. Every route first sweeps the
 * caller's stuck `applying` changes (plan Q4, section 6.5 step 9).
 */
@Controller("copilot/conversations")
@UseGuards(JwtAuthGuard, CopilotAccessGuard)
export class CopilotConversationsController {
  constructor(
    private readonly conversations: CopilotConversationsService,
    private readonly availability: CopilotAvailabilityService,
    private readonly pendingChanges: CopilotPendingChangesService,
    private readonly turns: CopilotTurnService,
    private readonly skills: CopilotSkillService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @CopilotIdentity() identity: ResolvedIdentity): Promise<CopilotConversationDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    let asked: string | null;
    try {
      asked = copilotCreateConversationBodySchema.parse(body).organizationId;
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(err.flatten());
      throw err;
    }
    // A scoped administrator's conversation is bound to the home organization whatever the body says (Q9).
    const bound = identity.role === "admin" ? asked : identity.organizationId;
    if (identity.role === "admin" && bound !== null) {
      if (!(await this.conversations.organizationExists(bound))) throw new NotFoundException("Organization not found");
      const decision = await this.availability.decide(identity, bound);
      if (!decision.available) throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
    }
    return this.conversations.create(identity.id, bound);
  }

  @Get()
  async list(@CopilotIdentity() identity: ResolvedIdentity): Promise<CopilotConversationDto[]> {
    await this.pendingChanges.sweepStuck(identity.id);
    return this.conversations.list(identity.id);
  }

  @Get(":id")
  async get(
    @Param("id") id: string,
    @CopilotIdentity() identity: ResolvedIdentity,
    @CurrentUser() user: JwtPayload,
  ): Promise<CopilotConversationDetailDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException("Conversation not found");
    // F3.86 PR 5: a skill conversation carries its session's state, so the dock reloads into the skill.
    return this.detail(identity, parsed.data, (sessionId) => (sessionId ? this.skills.stateOf(user, sessionId) : undefined));
  }

  /**
   * `F3.86` PR 5 / ADR 0099 decision 7 — starts the onboarding skill in this
   * conversation (`CopilotSkillService.start` holds the order). 201 with the
   * conversation, its opening line and the new session's state. With
   * `sessionId` it resumes that draft (`F4.255`, ADR 0099 Amendment 2 A1).
   */
  @Post(":id/skills/onboarding")
  @HttpCode(201)
  async startOnboarding(
    @Param("id") id: string,
    @Body() body: unknown,
    @CopilotIdentity() identity: ResolvedIdentity,
    @CurrentUser() user: JwtPayload,
  ): Promise<CopilotConversationDetailDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException("Conversation not found");
    let start: CopilotStartOnboardingSkillBody;
    try {
      start = copilotStartOnboardingSkillBodySchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(err.flatten());
      throw err;
    }
    const skill = await this.skills.start(identity, user, parsed.data, start.organizationId, start.sessionId);
    return this.detail(identity, parsed.data, () => skill);
  }

  /** `F3.86` PR 5 — ends the skill here; the draft stays, and the dock lists it for a resume (`F4.255`). 200 with the conversation. */
  @Delete(":id/skills/onboarding")
  @HttpCode(200)
  async endOnboarding(
    @Param("id") id: string,
    @CopilotIdentity() identity: ResolvedIdentity,
  ): Promise<CopilotConversationDetailDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException("Conversation not found");
    await this.skills.end(identity, parsed.data);
    return this.detail(identity, parsed.data, () => null);
  }

  /**
   * The conversation, its open changes and its skill: `skillOf` gets the bound
   * session id (or null) and answers the state, `null`, or `undefined` for a
   * plain conversation, which carries no `skill` key.
   */
  private async detail(
    identity: ResolvedIdentity,
    conversationId: string,
    skillOf: (sessionId: string | null) => CopilotSkillStateDto | null | undefined | Promise<CopilotSkillStateDto | null | undefined>,
  ): Promise<CopilotConversationDetailDto> {
    const found = await this.conversations.get(identity.id, conversationId);
    if (!found) throw new NotFoundException("Conversation not found");
    const { onboardingSessionId, ...conversation } = found;
    const skill = await skillOf(onboardingSessionId ?? null);
    // F3.85 PR 8: the cards still waiting, so a remount or the poll after a Confirm shows a follow-up's proposal.
    const open = await this.pendingChanges.listOpen(identity.id, conversationId);
    // F3.86 PR 6 review: a commit card with no draft skill behind it is rejected, and not shown.
    const pendingChanges = await liveOpenChanges(this.pendingChanges, identity.id, open, skill?.session.status === "draft");
    return { ...conversation, pendingChanges, ...(skill !== undefined ? { skill } : {}) };
  }

  /**
   * `F3.85` PR 7 — one read-only turn (ADR 0099 decisions 1, 9, 10, 11). The
   * body is the message alone; the organization comes from the conversation
   * row (`CopilotTurnService`), so another user's id or a non-uuid is a 404.
   * 200, not Nest's POST default 201: a turn creates no resource the caller
   * addresses.
   *
   * `F3.87` PR 7 (ADR 0099 Amendment 3 A4): the same route takes a multipart
   * body — the `message` field, the `wizards` field (`F4.245`, a JSON string)
   * and up to three `files`. A JSON request passes
   * multer untouched (`files` is undefined); a multipart one parses only its
   * `message` field. The limits are written inline for `tests/f4.102`. The
   * turn service decides every attachment rule, in its check order, before the
   * turn is counted; multer buffers the files before that, the cost
   * `asset-images-write.controller.ts` records.
   */
  @Post(":id/turns")
  @HttpCode(200)
  @UseInterceptors(
    FilesInterceptor("files", COPILOT_ATTACHMENTS_MAX, {
      limits: { fileSize: MAX_COPILOT_ATTACHMENT_BYTES, files: COPILOT_ATTACHMENTS_MAX, fields: 2, fieldSize: 32768 },
    }),
  )
  async turn(
    @Param("id") id: string,
    @Body() body: unknown,
    @CopilotIdentity() identity: ResolvedIdentity,
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() files?: UploadedAttachment[],
  ): Promise<CopilotTurnResponseDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException("Conversation not found");
    let turn: CopilotTurnBody;
    try {
      const multipart = body as { message?: unknown; wizards?: unknown } | undefined;
      // `F4.245`: a multipart turn carries its open wizards as a JSON string; a malformed one is a 400.
      const fields = files === undefined ? body : { message: multipart?.message, wizards: parseWizardsField(multipart?.wizards) };
      turn = copilotTurnBodySchema.parse(fields);
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(err.flatten());
      throw err;
    }
    // `F4.245` (ADR 0099 Amendment 4): each open wizard against its catalog entry (a mismatch is a 400).
    const wizards = checkOpenWizards(turn.wizards);
    return this.turns.turn({ identity, user }, parsed.data, turn.message, "user", files ?? [], wizards);
  }
}
