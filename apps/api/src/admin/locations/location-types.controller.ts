import { Controller, Get, UseGuards } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { LocationsAdminService } from "./locations.service";

/**
 * `F4.157` / ADR 0077 (plan D3, owner ruling OQ6) —
 * `GET /api/v1/admin/location-types`, the active rows of
 * `bms.location_types` for the admin locations form's Type select.
 *
 * **Its own controller, not a route on `LocationsAdminController`.** That
 * controller is `@Controller("admin/locations")` with `@Get(":id")`, so a
 * `GET admin/locations/location-types` would reach `getById` and be refused by
 * `idParamSchema.parse` as a 400.
 *
 * Same guard pair as `GET /admin/locations`: `JwtAuthGuard` here and
 * `requireMasterDataUser` in the service.
 */
@Controller("admin/location-types")
@UseGuards(JwtAuthGuard)
export class LocationTypesAdminController {
  constructor(private readonly service: LocationsAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.listLocationTypes(user);
  }
}
