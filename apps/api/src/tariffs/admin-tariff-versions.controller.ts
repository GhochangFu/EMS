import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { createTariffVersionBodySchema, deleteTariffVersionQuerySchema, updateTariffVersionBodySchema } from "@bms/shared";
import type { JwtPayload, TariffVersionDto } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OrgTariffVersionsService } from "./org-tariff-versions.service";

/**
 * `F4.365` U6 (ADR 0134 decision 8, Amendment 1) — an organization's own
 * tariff versions. Gate per plan D6 in the service (`isOrganizationLevelAdmin`).
 * Reads go through `GET /tariffs/lines/versions?key=`. A `ZodError` from a
 * parse is the global filter's 400 (ADR 0060).
 */
@Controller("admin/tariffs/versions")
@UseGuards(JwtAuthGuard)
export class AdminTariffVersionsController {
  constructor(private readonly service: OrgTariffVersionsService) {}

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<TariffVersionDto> {
    return this.service.create(user, createTariffVersionBodySchema.parse(body));
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload): Promise<TariffVersionDto> {
    return this.service.update(user, idParamSchema.parse(id), updateTariffVersionBodySchema.parse(body));
  }

  /** `?reason=` because a DELETE carries no body; the reason is the audit row's. */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<void> {
    const { reason } = deleteTariffVersionQuerySchema.parse(query);
    await this.service.remove(user, idParamSchema.parse(id), reason);
  }
}
