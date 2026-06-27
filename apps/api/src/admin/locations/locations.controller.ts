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
  createLocationBodySchema,
  updateLocationBodySchema,
} from "./locations.schema";
import { LocationsAdminService } from "./locations.service";

@Controller("admin/locations")
@UseGuards(JwtAuthGuard)
export class LocationsAdminController {
  constructor(private readonly service: LocationsAdminService) {}

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
      return await this.service.create(user, createLocationBodySchema.parse(body));
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
        updateLocationBodySchema.parse(body),
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
