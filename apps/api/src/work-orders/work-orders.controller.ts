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

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  closeWorkOrderBodySchema,
  createWorkOrderBodySchema,
  updateWorkOrderStatusBodySchema,
} from "./work-order.schema";
import { WorkOrdersService } from "./work-orders.service";

const idParamSchema = z.string().uuid();

@Controller("work-orders")
@UseGuards(JwtAuthGuard)
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  list(@Query("limit") limitRaw?: string) {
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (Number.isNaN(limit)) {
      throw new BadRequestException("Invalid limit");
    }
    return this.workOrders.list({ limit });
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const dto = createWorkOrderBodySchema.parse(body);
      return await this.workOrders.create(dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const workOrderId = idParamSchema.parse(id);
      const dto = updateWorkOrderStatusBodySchema.parse(body);
      return await this.workOrders.updateStatus(workOrderId, dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/close")
  @HttpCode(HttpStatus.OK)
  async close(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const workOrderId = idParamSchema.parse(id);
      const dto = closeWorkOrderBodySchema.parse(body);
      return await this.workOrders.close(workOrderId, user, dto.reason);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
