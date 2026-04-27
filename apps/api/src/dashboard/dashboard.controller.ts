import { Controller, Get, Query } from "@nestjs/common";

import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("kpis")
  kpis() {
    return this.dashboard.kpis();
  }

  @Get("load-trend")
  loadTrend(@Query("window") window?: string) {
    return this.dashboard.loadTrend(window);
  }

  /** Sprint 8 — Energy Centre (aggregations from electrical `kw` telemetry). */
  @Get("energy/summary")
  energySummary(@Query("window") window?: string) {
    return this.dashboard.energySummary(window);
  }

  @Get("energy/source-mix")
  energySourceMix(@Query("window") window?: string) {
    return this.dashboard.energySourceMix(window);
  }

  @Get("energy/top-consumers")
  energyTopConsumers(
    @Query("window") window?: string,
    @Query("limit") limit?: string,
  ) {
    const n = limit ? Number(limit) : 10;
    const lim = Number.isFinite(n) ? n : 10;
    return this.dashboard.energyTopConsumers(window, lim);
  }
}
