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

// F4.284 (ADR 0030): the write bodies live in `@bms/shared`, the copilot catalog's exports by identity.
import {
  closeWorkOrderBodySchema,
  createWorkOrderBodySchema,
  type JwtPayload,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WorkOrdersService } from "./work-orders.service";

const idParamSchema = z.string().uuid();

@Controller("work-orders")
@UseGuards(JwtAuthGuard)
export class WorkOrdersController {
  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query("limit") limitRaw?: string) {
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (Number.isNaN(limit)) {
      throw new BadRequestException("Invalid limit");
    }
    return this.workOrders.list({
      limit,
      assetIds: await this.accessControl.readableAssetIds(user),
    });
  }

  /**
   * `E3.1` (ADR 0122 decision 10) — one work order with its timeline. A read: no
   * operations write gate. The caller's readable assets are the scope, and a ticket
   * outside it answers 404, the same as one that does not exist.
   *
   * Declared above every other `:id` route on purpose (plan D13): later PRs add literal
   * `GET` paths (`cause-codes`, `checklist-templates`) that must be declared above this.
   */
  @Get(":id")
  async getOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    const parsedId = idParamSchema.safeParse(id);
    if (!parsedId.success) {
      throw new BadRequestException("Invalid work order id");
    }
    return this.workOrders.getDetail(parsedId.data, await this.accessControl.readableAssetIds(user));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const dto = createWorkOrderBodySchema.parse(body);
      return await this.workOrders.create(
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

  @Patch("reorder")
  async reorder(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const dto = reorderWorkOrdersBodySchema.parse(body);
      return await this.workOrders.reorder(
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

  @Patch(":id/status")
  async updateStatus(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const workOrderId = idParamSchema.parse(id);
      const dto = updateWorkOrderStatusBodySchema.parse(body);
      return await this.workOrders.updateStatus(
        workOrderId,
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

  @Post(":id/close")
  @HttpCode(HttpStatus.OK)
  async close(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const workOrderId = idParamSchema.parse(id);
      const dto = closeWorkOrderBodySchema.parse(body);
      return await this.workOrders.close(
        workOrderId,
        user,
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
}
