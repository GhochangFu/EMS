import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";

import { createLocationTariffBodySchema, updateLocationTariffBodySchema } from "@bms/shared";
import type { JwtPayload, LocationTariffDto, LocationTariffsResponse } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LocationTariffsService } from "./location-tariffs.service";

/**
 * `F4.365` U5 (ADR 0134 decision 3) — a location's tariff mappings. Gate per
 * plan D6 in the service: `requireMasterDataUser`, then `canManageLocation`.
 * A `ZodError` from a parse is the global filter's 400 (ADR 0060).
 */
@Controller("admin/locations/:locationId/tariffs")
@UseGuards(JwtAuthGuard)
export class LocationTariffsController {
  constructor(private readonly service: LocationTariffsService) {}

  @Get()
  async list(@Param("locationId") locationId: string, @CurrentUser() user: JwtPayload): Promise<LocationTariffsResponse> {
    return this.service.list(user, idParamSchema.parse(locationId));
  }

  @Post()
  async create(
    @Param("locationId") locationId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<LocationTariffDto> {
    return this.service.create(user, idParamSchema.parse(locationId), createLocationTariffBodySchema.parse(body));
  }

  @Patch(":mappingId")
  async update(
    @Param("locationId") locationId: string,
    @Param("mappingId") mappingId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<LocationTariffDto> {
    return this.service.update(
      user,
      idParamSchema.parse(locationId),
      idParamSchema.parse(mappingId),
      updateLocationTariffBodySchema.parse(body),
    );
  }

  @Delete(":mappingId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("locationId") locationId: string,
    @Param("mappingId") mappingId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.service.remove(user, idParamSchema.parse(locationId), idParamSchema.parse(mappingId));
  }
}
