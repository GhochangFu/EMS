import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import {
  addAssetGroupMemberBodySchema,
  createAssetGroupBodySchema,
  setAssetGroupMemberRoleBodySchema,
  updateAssetGroupBodySchema,
} from "./asset-groups.schema";
import { AssetGroupsAdminService } from "./asset-groups.service";

/** A body that fails its schema is a 400 naming the fields, never a 500. */
async function parsing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}

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

  /** `F3.78` (ADR 0089 decision 7) — create a group. */
  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return parsing(() => this.service.create(user, createAssetGroupBodySchema.parse(body)));
  }

  /** `F3.78` — rename or re-describe a group; the code is not editable. */
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return parsing(() =>
      this.service.update(user, idParamSchema.parse(id), updateAssetGroupBodySchema.parse(body)),
    );
  }

  /** `F3.78` — add an asset to a group. */
  @Post(":id/members")
  async addMember(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return parsing(() =>
      this.service.addMember(user, idParamSchema.parse(id), addAssetGroupMemberBodySchema.parse(body)),
    );
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

  /** `F3.78` — remove one membership; 204, no body. */
  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    return parsing(() => this.service.removeMember(user, idParamSchema.parse(id)));
  }
}
