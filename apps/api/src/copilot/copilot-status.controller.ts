import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import type { BmsDb } from "@bms/db";
import type { CopilotStatusDto, JwtPayload } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { resolveIdentity } from "../auth/identity-resolver";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AUTH_DRIZZLE } from "../database/database.tokens";
import { copilotStatusQuerySchema } from "./copilot-access.schema";
import { COPILOT_ROLES } from "./copilot-availability";
import { CopilotAvailabilityService } from "./copilot-availability.service";

export const COPILOT_STATUS_ROLE_MESSAGE = "The copilot is offered to administrators only";

/**
 * `GET /api/v1/copilot/status` — whether the copilot is available to the
 * caller here (`F3.85` PR 3, ADR 0099 decision 5).
 *
 * An operator, a viewer or an unprovisioned token gets **403**, not
 * `available: false`: the copilot is not offered to them at all (the ADR's
 * live-stack claim). An administrator gets the decision and its reason.
 * `organizationId` omitted means the caller's own organization, or none for the
 * global admin (a cross-organization conversation). `configured` stays `false`
 * until the model wiring lands (plan PR 7).
 */
@Controller("copilot/status")
@UseGuards(JwtAuthGuard)
export class CopilotStatusController {
  constructor(
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
    private readonly availability: CopilotAvailabilityService,
  ) {}

  @Get()
  async get(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<CopilotStatusDto> {
    let organizationId: string | undefined;
    try {
      organizationId = copilotStatusQuerySchema.parse(query).organizationId;
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
    const identity = await resolveIdentity(this.authDb, user);
    if (identity === null || !(COPILOT_ROLES as readonly string[]).includes(identity.role)) {
      throw new ForbiddenException(COPILOT_STATUS_ROLE_MESSAGE);
    }
    const asked = organizationId ?? (identity.role === "admin" ? null : identity.organizationId);
    const decision = await this.availability.decide(identity, asked);
    return decision.available
      ? { available: true, configured: false }
      : { available: false, reason: decision.reason, configured: false };
  }
}
