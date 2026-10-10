import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { type ResolvedIdentity, resolveIdentity } from "../auth/identity-resolver";
import { AUTH_DRIZZLE } from "../database/database.tokens";
import { COPILOT_ROLES } from "./copilot-availability";
import { CopilotAvailabilityService } from "./copilot-availability.service";

export const COPILOT_UNAVAILABLE_MESSAGE = "The copilot is not available to you here";

type CopilotRequest = { user?: JwtPayload; copilotIdentity?: ResolvedIdentity };

/**
 * Route-level guard for the copilot's own routes (`F3.85` PR 5, ADR 0099
 * decision 5): the caller must be an administrator for whom `decide()` says
 * available, for their own organization (none for the global admin). Anything
 * else is 403. Used with `@UseGuards(JwtAuthGuard, CopilotAccessGuard)` on a
 * controller; it is never registered for every route. It leaves the resolved
 * identity on the request for `CopilotIdentity`.
 */
@Injectable()
export class CopilotAccessGuard implements CanActivate {
  constructor(
    @Inject(AUTH_DRIZZLE) private readonly authDb: BmsDb,
    private readonly availability: CopilotAvailabilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CopilotRequest>();
    if (!request.user) throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
    const identity = await resolveIdentity(this.authDb, request.user);
    if (identity === null || !(COPILOT_ROLES as readonly string[]).includes(identity.role)) {
      throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
    }
    const decision = await this.availability.decide(
      identity,
      identity.role === "admin" ? null : identity.organizationId,
    );
    if (!decision.available) throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
    request.copilotIdentity = identity;
    return true;
  }
}

/** The identity `CopilotAccessGuard` resolved for this request. */
export const CopilotIdentity = createParamDecorator((_data: unknown, ctx: ExecutionContext): ResolvedIdentity => {
  const identity = ctx.switchToHttp().getRequest<CopilotRequest>().copilotIdentity;
  if (!identity) throw new ForbiddenException(COPILOT_UNAVAILABLE_MESSAGE);
  return identity;
});
