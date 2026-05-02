import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get("kpis")
  async kpis(@CurrentUser() user: JwtPayload) {
    return this.dashboard.kpis(await this.accessControl.readableAssetIds(user));
  }

  @Get("locations")
  async locationKpis(@CurrentUser() user: JwtPayload) {
    const currentUser = await this.accessControl.currentUser(user);
    return this.dashboard.locationKpis({
      locationIds:
        currentUser.scope.kind === "global"
          ? null
          : currentUser.scope.locations.map((location) => location.id),
      assetIds:
        currentUser.scope.kind === "global" ? null : currentUser.scope.assetIds,
      partial: currentUser.scope.kind === "asset_group",
    });
  }

  @Get("locations/:locationId")
  async locationDashboard(
    @CurrentUser() user: JwtPayload,
    @Param("locationId") locationId: string,
  ) {
    const currentUser = await this.accessControl.currentUser(user);
    const payload = await this.dashboard.locationDashboard(locationId, {
      locationIds:
        currentUser.scope.kind === "global"
          ? null
          : currentUser.scope.locations.map((location) => location.id),
      assetIds:
        currentUser.scope.kind === "global" ? null : currentUser.scope.assetIds,
      partial: currentUser.scope.kind === "asset_group",
    });
    if (!payload) {
      throw new NotFoundException("Location not found or outside your access scope");
    }
    return payload;
  }

  @Get("load-trend")
  async loadTrend(@CurrentUser() user: JwtPayload, @Query("window") window?: string) {
    return this.dashboard.loadTrend(window, await this.accessControl.readableAssetIds(user));
  }

  /** Sprint 8 — Energy Centre (aggregations from electrical `kw` telemetry). */
  @Get("energy/summary")
  async energySummary(@CurrentUser() user: JwtPayload, @Query("window") window?: string) {
    return this.dashboard.energySummary(window, await this.accessControl.readableAssetIds(user));
  }

  @Get("energy/source-mix")
  async energySourceMix(@CurrentUser() user: JwtPayload, @Query("window") window?: string) {
    return this.dashboard.energySourceMix(window, await this.accessControl.readableAssetIds(user));
  }

  @Get("energy/top-consumers")
  energyTopConsumers(
    @CurrentUser() user: JwtPayload,
    @Query("window") window?: string,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : 10;
    const lim = Number.isFinite(n) ? n : 10;
    return this.accessControl
      .readableAssetIds(user)
      .then((assetIds) => this.dashboard.energyTopConsumers(window, lim, assetIds));
  }
}
