import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z, ZodError } from "zod";

// F4.359 (ADR 0030): the write bodies live in `@bms/shared`, parsed here by name (the catalog's exports by identity).
import {
  closeMaintenanceWindowBodySchema,
  createMaintenanceWindowBodySchema,
  extendMaintenanceWindowBodySchema,
  type JwtPayload,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { MaintenanceWindowReadScope } from "./maintenance-window-scope";
import { maintenanceWindowListQuerySchema } from "./maintenance-windows.schema";
import { MaintenanceWindowsService } from "./maintenance-windows.service";

const idParamSchema = z.string().uuid();

/** A `ZodError` from the query, the id or the body is the caller's mistake: a 400. */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  try {
    return schema.parse(value) as z.output<S>;
  } catch (err) {
    if (err instanceof ZodError) throw new BadRequestException(err.flatten());
    throw err;
  }
}

/**
 * `F4.359` U3 (ADR 0131 decisions 13 and 14; plan Q5) — maintenance windows.
 *
 * Every write asks `assertOperationsWriteRole(user, "configuration")` **first**
 * (it refuses `operator` and `viewer`; owner ruling Q5 admits
 * `asset_group_admin`), then parses its body, then reads the caller's scope —
 * so a role refusal never depends on scope resolution (ADR 0017).
 */
@Controller("maintenance-windows")
@UseGuards(JwtAuthGuard)
export class MaintenanceWindowsController {
  constructor(
    private readonly windows: MaintenanceWindowsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** The windows the caller reads; every filter narrows and none widens (a node it cannot read answers empty). */
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    const dto = parse(maintenanceWindowListQuerySchema, query);
    return this.windows.list(dto, await this.scope(user));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const dto = parse(createMaintenanceWindowBodySchema, body);
    return this.windows.create(user, dto, await this.scope(user));
  }

  @Post(":id/extend")
  @HttpCode(HttpStatus.OK)
  async extend(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const windowId = parse(idParamSchema, id);
    const dto = parse(extendMaintenanceWindowBodySchema, body);
    return this.windows.extend(user, windowId, dto, await this.scope(user));
  }

  @Post(":id/end")
  @HttpCode(HttpStatus.OK)
  async end(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const windowId = parse(idParamSchema, id);
    const dto = parse(closeMaintenanceWindowBodySchema, body);
    return this.windows.end(user, windowId, dto, await this.scope(user));
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    const windowId = parse(idParamSchema, id);
    const dto = parse(closeMaintenanceWindowBodySchema, body);
    return this.windows.cancel(user, windowId, dto, await this.scope(user));
  }

  /** The caller's three readable sets (all `null` for the admin). */
  private async scope(user: JwtPayload): Promise<MaintenanceWindowReadScope> {
    return {
      assetIds: await this.accessControl.readableAssetIds(user),
      locationIds: await this.accessControl.readableLocationIds(user),
      organizationIds: await this.accessControl.readableOrganizationIds(user),
    };
  }
}
