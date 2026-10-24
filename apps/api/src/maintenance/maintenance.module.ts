import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";

@Module({
  controllers: [MaintenanceController],
  // F4.281 (ADR 0099 Amendment 8): the audit funnel (the copilot `via` mark), and the
  // export the copilot's `list_maintenance_schedules` read tool injects.
  providers: [MaintenanceService, MasterDataAuditService, JwtAuthGuard],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
