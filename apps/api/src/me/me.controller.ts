import { BadRequestException, Body, Controller, Put, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import { setMyAppearanceBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { PortalSettingsService } from "../admin/portal-settings/portal-settings.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

/**
 * `F4.341` (ADR 0118 decision 10) — `PUT /api/v1/me/appearance`, the caller's own design system
 * and colour profile (each nullable: `null` inherits). Any signed-in user, for themself only: the
 * row is the session's, never one named in the request. A body other than the strict two-key shape
 * is a 400.
 */
@Controller("me")
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly service: PortalSettingsService) {}

  @Put("appearance")
  async setAppearance(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.writeMine(user, setMyAppearanceBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
