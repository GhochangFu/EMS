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
import { ZodError, z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  convertMaintenanceBodySchema,
  createMaintenanceScheduleBodySchema,
  listMaintenanceQuerySchema,
  updateMaintenanceScheduleBodySchema,
} from "./maintenance.schema";
import { MaintenanceService } from "./maintenance.service";

const idParamSchema = z.string().uuid();

@Controller("maintenance")
@UseGuards(JwtAuthGuard)
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get("schedules")
  async listSchedules(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    try {
      const dto = listMaintenanceQuerySchema.parse(query);
      return await this.maintenance.list(
        dto,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post("schedules")
  async createSchedule(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const dto = createMaintenanceScheduleBodySchema.parse(body);
      return await this.maintenance.createSchedule(
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post("schedules/:id/convert")
  @HttpCode(HttpStatus.OK)
  async convert(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const scheduleId = idParamSchema.parse(id);
      const dto = convertMaintenanceBodySchema.parse(body);
      return await this.maintenance.convertToWorkOrder(
        scheduleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch("schedules/:id")
  async updateSchedule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const scheduleId = idParamSchema.parse(id);
      const dto = updateMaintenanceScheduleBodySchema.parse(body);
      return await this.maintenance.updateSchedule(
        scheduleId,
        dto,
        user,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
