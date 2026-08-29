import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  createDashboardBodySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  putDashboardWidgetsBodySchema,
  updateDashboardBodySchema,
} from "./dashboards.schema";
import { DashboardsService } from "./dashboards.service";

const idParamSchema = z.string().uuid();

/**
 * `F3.1b` — the dashboard read/write API (ADR 0047). Route base `/dashboards`.
 *
 * **NOT `DashboardsController`.** `apps/api/src/dashboard/dashboard.controller.ts` is
 * `@Controller("dashboard")` and holds the FIXED control-room reads (`kpis`, `load-trend`,
 * `energySummary`, …); `dashboard-builder.ts`'s own docblock warns that two files one plural
 * apart is how the wrong one gets imported. This controller's base path is the plural
 * `/dashboards`, matching the plural table it serves.
 *
 * **The `assertOperationsWriteRole` gate runs HERE, before the service is ever called** — in
 * addition to `DashboardsService`'s own internal call to the same gate. Order matters: a
 * rejection at this layer means the (possibly expensive, possibly DB-touching) service method
 * never runs at all, which is directly testable against a stubbed service and is what
 * `dashboard-builder.controller.spec.ts` proves. `canManageDashboard` — the scope-specific half
 * of §4.7's additive pair — stays inside the service, because authorizing a PATCH/DELETE/PUT
 * needs the target row's own organization and scope, which only the service has fetched.
 */
@Controller("dashboards")
@UseGuards(JwtAuthGuard)
export class DashboardBuilderController {
  constructor(
    private readonly dashboards: DashboardsService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    const { organizationId } = parse(listDashboardsQuerySchema, query);
    return this.dashboards.list(user, organizationId);
  }

  @Get(":slug")
  async getBySlug(@CurrentUser() user: JwtPayload, @Param("slug") slug: string, @Query() query: unknown) {
    const { organizationId } = parse(getDashboardQuerySchema, query);
    return this.dashboards.getBySlug(user, slug, organizationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    return this.dashboards.create(user, parse(createDashboardBodySchema, body));
  }

  @Patch(":id")
  async update(@CurrentUser() user: JwtPayload, @Param("id") id: string, @Body() body: unknown) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    return this.dashboards.update(user, parse(idParamSchema, id), parse(updateDashboardBodySchema, body));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async remove(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    await this.dashboards.remove(user, parse(idParamSchema, id));
    return { deleted: true as const };
  }

  @Put(":id/widgets")
  async putWidgets(@CurrentUser() user: JwtPayload, @Param("id") id: string, @Body() body: unknown) {
    await this.accessControl.assertOperationsWriteRole(user, "configuration");
    return this.dashboards.putWidgets(
      user,
      parse(idParamSchema, id),
      parse(putDashboardWidgetsBodySchema, body),
    );
  }
}

/** `.parse()` with the repo's `ZodError → BadRequestException(flatten())` shape, matching
 * every other controller's `parse` helper (e.g. `notifications.controller.ts`). */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}
