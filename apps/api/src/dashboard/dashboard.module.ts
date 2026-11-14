import { Module } from "@nestjs/common";

import { AssetHealthModule } from "../asset-health/asset-health.module";
import { CalcModule } from "../calc/calc.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  // `E4.1c` — `CalcParametersService` for the tariff read (ADR 0070 decision 7).
  // `F4.364` — `AssetHealthService` for the location cards' health figure (ADR 0133
  // decision 4). `AssetHealthModule` imports only `AuthModule`, so this adds no cycle.
  imports: [CalcModule, AssetHealthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  // `F4.275` — the copilot's energy and portfolio read tools (`CopilotModule`).
  exports: [DashboardService],
})
export class DashboardModule {}
