import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";
import { putOrgTrendPointsBodySchema } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TrendPointsService } from "./trend-points.service";

/**
 * `F4.300` / ADR 0108 decision 3.6 — the effective trend points for a site, the
 * read `F4.301` and `F4.302` consume. Readable is "can read the site";
 * `TrendPointsService.forSite` owns that rule and answers a 404 otherwise.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class SiteTrendPointsController {
  constructor(private readonly service: TrendPointsService) {}

  @Get("sites/:locationId/trend-points")
  async forSite(@Param("locationId") locationId: string, @CurrentUser() user: JwtPayload) {
    return this.service.forSite(user, idParamSchema.parse(locationId));
  }
}

/**
 * `F4.300` / ADR 0108 decisions 3.4 and 3.5 — an organization's trend-point
 * list, read and replaced one segment at a time. The gate (an organization
 * admin of this organization, or a global admin) lives in the service.
 */
@Controller("admin/organizations/:organizationId/trend-points")
@UseGuards(JwtAuthGuard)
export class OrgTrendPointsAdminController {
  constructor(private readonly service: TrendPointsService) {}

  @Get()
  async forOrganization(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.forOrganization(user, idParamSchema.parse(organizationId));
  }

  @Put(":domain")
  async putSegment(
    @Param("organizationId") organizationId: string,
    @Param("domain") domain: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.putSegment(
        user,
        idParamSchema.parse(organizationId),
        domain,
        putOrgTrendPointsBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
