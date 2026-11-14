import { Module } from "@nestjs/common";

import { AssetHealthModule } from "../asset-health/asset-health.module";
import { TariffRatesModule } from "../tariffs/tariff-rates.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  // `E4.1c` — the tariff read (ADR 0070 decision 7); since `F4.365` U7 it is
  // `EnergyRateResolver`, from the provider-only `TariffRatesModule`.
  // `F4.364` — `AssetHealthService` for the location cards' health figure (ADR 0133
  // decision 4). `AssetHealthModule` imports only `AuthModule`, so this adds no cycle.
  imports: [TariffRatesModule, AssetHealthModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  // `F4.275` — the copilot's energy and portfolio read tools (`CopilotModule`).
  exports: [DashboardService],
})
export class DashboardModule {}
