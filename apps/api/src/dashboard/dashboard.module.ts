import { Module } from "@nestjs/common";

import { CalcModule } from "../calc/calc.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  // `E4.1c` — `CalcParametersService` for the tariff read (ADR 0070 decision 7).
  imports: [CalcModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
