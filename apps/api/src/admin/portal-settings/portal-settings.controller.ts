import { BadRequestException, Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import { setPortalAppearanceBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PortalSettingsService } from "./portal-settings.service";

/**
 * `F4.341` (ADR 0118 decision 10) — the portal default appearance, `GET`/`PUT
 * /api/v1/admin/portal-settings/appearance`. The global `admin` only (the service's
 * `assertAdminRole`); a body other than the strict two-key shape is a 400.
 */
@Controller("admin/portal-settings")
@UseGuards(JwtAuthGuard)
export class PortalSettingsController {
  constructor(private readonly service: PortalSettingsService) {}

  @Get("appearance")
  async getAppearance(@CurrentUser() user: JwtPayload) {
    return this.service.read(user);
  }

  @Put("appearance")
  async setAppearance(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.write(user, setPortalAppearanceBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
