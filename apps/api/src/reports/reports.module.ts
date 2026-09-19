import { Module } from "@nestjs/common";

import { CalcModule } from "../calc/calc.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  // `E4.1c` — `CalcParametersService` for the tariff read (ADR 0070 decision 7).
  imports: [CalcModule],
  controllers: [ReportsController],
  providers: [ReportsService, JwtAuthGuard],
})
export class ReportsModule {}
