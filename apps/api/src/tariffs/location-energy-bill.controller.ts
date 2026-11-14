import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";

import type { EnergyBill, JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { LocationEnergyBillService } from "./location-energy-bill.service";
import { locationEnergyBillQuerySchema } from "./tariffs.schema";

/** `F4.365` U5 (ADR 0134 decision 6) — a location's monthly energy bill. */
@Controller("locations")
@UseGuards(JwtAuthGuard)
export class LocationEnergyBillController {
  constructor(private readonly service: LocationEnergyBillService) {}

  @Get(":locationId/energy-bill")
  async bill(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<EnergyBill> {
    const { month } = locationEnergyBillQuerySchema.parse(query);
    return this.service.bill(user, idParamSchema.parse(locationId), month);
  }
}
