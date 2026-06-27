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
  createPointKeyBodySchema,
  updatePointKeyBodySchema,
} from "./point-keys.schema";
import { PointKeysAdminService } from "./point-keys.service";

@Controller("admin/point-keys")
@UseGuards(JwtAuthGuard)
export class PointKeysAdminController {
  constructor(private readonly service: PointKeysAdminService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId?: string,
    @Query("active") active?: string,
  ) {
    return this.service.list(
      user,
      organizationId ? idParamSchema.parse(organizationId) : undefined,
      parseActiveFilter(active),
    );
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, idParamSchema.parse(id));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createPointKeyBodySchema.parse(body));
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
        updatePointKeyBodySchema.parse(body),
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
