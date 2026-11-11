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
import { ZodError, z } from "zod";

// F4.284 (ADR 0030): the write bodies live in `@bms/shared`, the copilot catalog's exports by identity.
import {
  closeWorkOrderBodySchema,
  createWorkOrderBodySchema,
  createWorkOrderTaskBodySchema,
  type JwtPayload,
  putWorkOrderRootCauseBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
  updateWorkOrderTaskBodySchema,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WorkOrderFindingsService } from "./work-order-findings.service";
import { WorkOrderTaskAddService } from "./work-order-task-add.service";
import { WorkOrderTasksService } from "./work-order-tasks.service";
import { WorkOrdersService } from "./work-orders.service";

const idParamSchema = z.string().uuid();

@Controller("work-orders")
@UseGuards(JwtAuthGuard)
export class WorkOrdersController {
  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly accessControl: AccessControlService,
    private readonly tasks: WorkOrderTasksService,
    private readonly taskAdd: WorkOrderTaskAddService,
    private readonly findings: WorkOrderFindingsService,
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
   * `E3.1` (ADR 0122 decision 10, ruling P6) — the active checklist templates that fit
   * one asset, for the create form's picker. A read for anyone who can read the asset,
   * an `operator` included: no operations write gate and no admin gate. An asset outside
   * the caller's read scope answers an empty list.
   *
   * A literal path: it MUST stay declared above `@Get(":id")` (plan D13), or Nest
   * routes `checklist-templates` to the detail read as an id.
   */
  @Get("checklist-templates")
  async listChecklistTemplates(@CurrentUser() user: JwtPayload, @Query("assetId") assetId: unknown) {
    const parsedAssetId = idParamSchema.safeParse(assetId);
    if (!parsedAssetId.success) {
      throw new BadRequestException("Invalid asset id");
    }
    return this.tasks.listTemplatesForAsset(parsedAssetId.data, await this.accessControl.readableAssetIds(user));
  }

  /**
   * `E3.1` (ADR 0122 decision 10) — the active cause codes, for the root-cause form's
   * select. A read for every signed-in user: the codes are platform vocabulary and say
   * nothing about any organization. A literal path, declared above `@Get(":id")`.
   */
  @Get("cause-codes")
  async listCauseCodes() {
    return this.findings.listCauseCodes();
  }

  /**
   * `E3.1` (ADR 0122 decision 10) — one work order with its timeline. A read: no
   * operations write gate. The caller's readable assets are the scope, and a ticket
   * outside it answers 404, the same as one that does not exist.
   *
   * Declared above every other `:id` route on purpose (plan D13). A literal `GET` path
   * (`checklist-templates` and `cause-codes`, above) must be declared above this one.
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
      // Owner ruling, 2026-11-11 (ADR 0122 decision 3.2): only the four admin roles may
      // override the SLA of one ticket. An `operator` who sends `slaMinutes` is refused
      // (403); an operator's ticket always takes the policy or the default. The role is
      // read from `bms.users`, like every other gate.
      if (dto.slaMinutes !== undefined) {
        await this.accessControl.assertWorkOrderSlaOverrideRole(user);
      }
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

  /**
   * `E3.1` (ADR 0122 decision 5): the ticket's findings, replaced whole. Allowed while
   * the ticket is `resolved` or earlier; 409 once it is `closed`.
   */
  @Put(":id/root-cause")
  async putRootCause(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const workOrderId = idParamSchema.parse(id);
      const dto = putWorkOrderRootCauseBodySchema.parse(body);
      return await this.findings.putRootCause(workOrderId, dto, user, await this.accessControl.readableAssetIds(user));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /** `E3.1` (ADR 0122 decision 4.3): one checklist item added to a ticket by hand. */
  @Post(":id/tasks")
  async addTask(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const workOrderId = idParamSchema.parse(id);
      const dto = createWorkOrderTaskBodySchema.parse(body);
      return await this.taskAdd.addTask(workOrderId, dto, user, await this.accessControl.readableAssetIds(user));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /** `E3.1` (ADR 0122 decision 4): one checklist item's result, its note, or both. */
  @Patch(":id/tasks/:taskId")
  async updateTask(
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const workOrderId = idParamSchema.parse(id);
      const parsedTaskId = idParamSchema.parse(taskId);
      const dto = updateWorkOrderTaskBodySchema.parse(body);
      return await this.tasks.updateTask(workOrderId, parsedTaskId, dto, user, await this.accessControl.readableAssetIds(user));
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
