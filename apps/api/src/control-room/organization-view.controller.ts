import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import { putOrganizationControlRoomViewBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OrganizationLayoutService } from "./organization-layout.service";

/**
 * `F4.317` task 4.2 (ADR 0112 decisions 3, 4 and 5) — the organization Control Room strip: the
 * read every reader of the organization page makes, "Make organization layout" (`PUT`) and
 * "Reset to default" (`DELETE`). `OrganizationLayoutService` owns every rule: the read is a 404
 * for an organization the caller cannot read; the writes are a 403 for a caller who may not
 * change the strip.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class OrganizationViewController {
  constructor(private readonly layout: OrganizationLayoutService) {}

  @Get("organizations/:organizationId/view")
  async view(@Param("organizationId") organizationId: string, @CurrentUser() user: JwtPayload) {
    return this.layout.view(user, idParamSchema.parse(organizationId));
  }

  /** Ruling Q2 — 409 "Reset to default first" over a live layout. */
  @Put("organizations/:organizationId/view")
  async make(
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const id = idParamSchema.parse(organizationId);
      const parsed = putOrganizationControlRoomViewBodySchema.parse(body ?? {});
      return await this.layout.make(user, id, parsed);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /** The row goes and the copy stays; 204 whether or not a row was there. */
  @Delete("organizations/:organizationId/view")
  @HttpCode(204)
  async reset(@Param("organizationId") organizationId: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.layout.reset(user, idParamSchema.parse(organizationId));
  }
}
