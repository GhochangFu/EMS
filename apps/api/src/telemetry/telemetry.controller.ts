import { Controller, Get, Param, Query } from "@nestjs/common";

import { TelemetryService } from "./telemetry.service";

@Controller("telemetry")
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  /** Historical window for charts and TanStack Query seed data. */
  @Get("points/:pointRef/recent")
  recent(
    @Param("pointRef") pointRef: string,
    @Query("window") window?: string,
  ) {
    return this.telemetry.recentForPoint(pointRef, window);
  }
}
