import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MaintenanceWindowsController } from "./maintenance-windows.controller";
import { MaintenanceWindowsService } from "./maintenance-windows.service";

/**
 * `F4.359` U3 (ADR 0131) — the maintenance-window routes. `AccessControlService`
 * reaches the controller as it reaches `MaintenanceModule`'s (the
 * `@Global()` `AccessControlModule`); the audit funnel is provided here as `AlarmsModule` provides it.
 */
@Module({
  controllers: [MaintenanceWindowsController],
  providers: [MaintenanceWindowsService, MasterDataAuditService, JwtAuthGuard],
})
export class MaintenanceWindowsModule {}
