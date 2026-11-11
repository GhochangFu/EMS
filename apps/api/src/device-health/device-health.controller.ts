import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";

import type { DeviceHealthResponse, JwtPayload, RtuDropHistoryResponse } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DeviceHealthService } from "./device-health.service";

/**
 * `F3.16` / ADR 0127 decisions 4 and 14 — per-RTU health for the admin RTUs
 * page, and one RTU's 30-day drop history. Reads only; the service owns the
 * master-data gate (`RtusAdminService.list`'s). No write route, so nothing
 * here belongs in the copilot catalog.
 */
@Controller("admin/device-health")
@UseGuards(JwtAuthGuard)
export class DeviceHealthController {
  constructor(private readonly service: DeviceHealthService) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("locationId") locationId?: string,
  ): Promise<DeviceHealthResponse> {
    return this.service.list(user, locationId ? idParamSchema.parse(locationId) : undefined);
  }

  @Get("rtus/:id/drops")
  async drops(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<RtuDropHistoryResponse> {
    return this.service.dropHistory(user, idParamSchema.parse(id));
  }
}
