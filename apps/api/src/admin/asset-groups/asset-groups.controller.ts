import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { setAssetGroupMemberRoleBodySchema } from "./asset-groups.schema";
import { AssetGroupsAdminService } from "./asset-groups.service";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin reads.
 *
 * Two controllers rather than one, because the membership write is addressed
 * by *membership* id and not by group id: `PATCH /admin/asset-groups/:id/...`
 * would have to carry both, and the group id in the path would then be
 * decorative — a second identifier the server must either ignore or check.
 */
@Controller("admin/asset-groups")
@UseGuards(JwtAuthGuard)
export class AssetGroupsAdminController {
  constructor(private readonly service: AssetGroupsAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query("locationId") locationId?: string) {
    return this.service.list(user, locationId ? idParamSchema.parse(locationId) : undefined);
  }

  @Get(":id/members")
  async members(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.members(user, idParamSchema.parse(id));
  }
}

/**
 * `PATCH /api/v1/admin/asset-group-members/:id` — set or clear one
 * membership's role (ADR 0049 decision 5).
 */
@Controller("admin/asset-group-members")
@UseGuards(JwtAuthGuard)
export class AssetGroupMembersAdminController {
  constructor(private readonly service: AssetGroupsAdminService) {}

  @Patch(":id")
  async setRole(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.setMemberRole(
        user,
        idParamSchema.parse(id),
        setAssetGroupMemberRoleBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
