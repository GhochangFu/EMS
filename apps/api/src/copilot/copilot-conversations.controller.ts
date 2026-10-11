import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import {
  type CopilotConversationDetailDto,
  type CopilotConversationDto,
  copilotCreateConversationBodySchema,
  copilotTurnBodySchema,
  type CopilotTurnResponseDto,
  type JwtPayload,
} from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import type { ResolvedIdentity } from "../auth/identity-resolver";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { COPILOT_UNAVAILABLE_MESSAGE, CopilotAccessGuard, CopilotIdentity } from "./copilot-access.guard";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
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
  ): Promise<CopilotConversationDetailDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException("Conversation not found");
    const found = await this.conversations.get(identity.id, parsed.data);
    if (!found) throw new NotFoundException("Conversation not found");
    // F3.85 PR 8: the cards still waiting, so a remount or the poll after a Confirm shows a follow-up's proposal.
    return { ...found, pendingChanges: await this.pendingChanges.listOpen(identity.id, parsed.data) };
  }

  /**
   * `F3.85` PR 7 — one read-only turn (ADR 0099 decisions 1, 9, 10, 11). The
   * body is the message alone; the organization comes from the conversation
   * row (`CopilotTurnService`), so another user's id or a non-uuid is a 404.
   * 200, not Nest's POST default 201: a turn creates no resource the caller
   * addresses.
   */
  @Post(":id/turns")
  @HttpCode(200)
  async turn(
    @Param("id") id: string,
    @Body() body: unknown,
    @CopilotIdentity() identity: ResolvedIdentity,
    @CurrentUser() user: JwtPayload,
  ): Promise<CopilotTurnResponseDto> {
    await this.pendingChanges.sweepStuck(identity.id);
    const parsed = idParamSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException("Conversation not found");
    let message: string;
    try {
      message = copilotTurnBodySchema.parse(body).message;
    } catch (err) {
      if (err instanceof ZodError) throw new BadRequestException(err.flatten());
      throw err;
    }
    return this.turns.turn({ identity, user }, parsed.data, message, "user");
  }
}
