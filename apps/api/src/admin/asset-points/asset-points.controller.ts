import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { idParamSchema, parseActiveFilter } from "../admin.schema";
import {
  createAssetPointBodySchema,
  updateAssetPointBodySchema,
} from "./asset-points.schema";
import { AssetPointsAdminService } from "./asset-points.service";

@Controller("admin/asset-points")
@UseGuards(JwtAuthGuard)
export class AssetPointsAdminController {
  constructor(private readonly service: AssetPointsAdminService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("assetId") assetId?: string,
    @Query("locationId") locationId?: string,
    @Query("active") active?: string,
  ) {
    return this.service.list(
      user,
      assetId ? idParamSchema.parse(assetId) : undefined,
      locationId ? idParamSchema.parse(locationId) : undefined,
      parseActiveFilter(active),
    );
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createAssetPointBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.update(
        user,
        idParamSchema.parse(id),
        updateAssetPointBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.deactivate(user, idParamSchema.parse(id));
  }

  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.reactivate(user, idParamSchema.parse(id));
  }
}
