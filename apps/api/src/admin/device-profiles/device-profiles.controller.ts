import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { DeviceProfilesAdminService } from "./device-profiles.service";

/**
 * `F1.2` (ADR 0141 decisions 12–14, plan T5.2) — an organization's Modbus
 * device profiles. Thin by design: the service owns the gate order
 * (403 → 400 → 404 → 409) and parses the query, the bodies and the path
 * segments after the role gate.
 *
 * **`@Get("stock")` is declared before `@Get(":id")`**, and the stock import
 * before the `:id` posts, so the literal path is never read as an id (the
 * `asset-templates.controller.ts` rule).
 *
 * There is no update and no delete: every save is a new row (plan P2), and
 * the table grants neither (migration `0164`).
 */
@Controller("admin/device-profiles")
@UseGuards(JwtAuthGuard)
export class DeviceProfilesAdminController {
  constructor(private readonly service: DeviceProfilesAdminService) {}

  @Get()
  async list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.list(user, query);
  }

  @Get("stock")
  async listStock(@CurrentUser() user: JwtPayload) {
    return this.service.listStock(user);
  }

  @Post("stock/:code/import")
  async importStock(@Param("code") code: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.importStock(user, code, body);
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, id);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(user, body);
  }

  @Post(":id/versions")
  async saveVersion(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.saveVersion(user, id, body);
  }

  @Post(":id/copy")
  async copy(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.copy(user, id, body);
  }
}
