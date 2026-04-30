import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, JwtAuthGuard],
})
export class MaintenanceModule {}
