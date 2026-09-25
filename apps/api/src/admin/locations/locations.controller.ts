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
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { SiteControlRoomViewService } from "../../control-room/site-control-room-view.service";
import { putSiteControlRoomViewBodySchema } from "../../control-room/site-control-room-view.schema";
import { idParamSchema, parseActiveFilter } from "../admin.schema";
import {
  createLocationBodySchema,
  updateLocationBodySchema,
} from "./locations.schema";
import { LocationsAdminService } from "./locations.service";

@Controller("admin/locations")
@UseGuards(JwtAuthGuard)
export class LocationsAdminController {
  constructor(
    private readonly service: LocationsAdminService,
    private readonly controlRoomView: SiteControlRoomViewService,
  ) {}

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

  /** `F3.67` U4 / ADR 0076 decision 5 — the stored setting for the admin form. */
  @Get(":id/control-room-view")
  async getControlRoomView(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.controlRoomView.getSetting(user, idParamSchema.parse(id));
  }

  /** `F3.67` U4 / ADR 0076 decision 5, OQ1 — `builtin` is the global admin's alone. */
  @Put(":id/control-room-view")
  async putControlRoomView(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.controlRoomView.putSetting(
        user,
        idParamSchema.parse(id),
        putSiteControlRoomViewBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
