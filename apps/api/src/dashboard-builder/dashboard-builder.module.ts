import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DashboardBuilderController } from "./dashboard-builder.controller";
import { DashboardsService } from "./dashboards.service";

/**
 * `F3.1b` — the dashboard read/write API (ADR 0047). Follows
 * `apps/api/src/notifications/notifications.module.ts`'s shape: `DatabaseModule` for the
 * tenant/fleet Drizzle tokens `DashboardsService` injects, `AuthModule` for
 * `AccessControlService`. `MasterDataAuditService` is provided here rather than imported —
 * it is stateless (reads its Drizzle handles from `DatabaseModule`'s tokens on each call), so a
 * second instance is not a second copy of anything, matching how `AdminModule` and
 * `NotificationsModule` each provide their own instance rather than sharing one.
 *
 * Registered in `app.module.ts` beside `DashboardModule` — the fixed control-room reads and
 * this configurable-dashboard surface are deliberately two modules, not one, following D1's
 * naming split.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DashboardBuilderController],
  providers: [DashboardsService, MasterDataAuditService],
})
export class DashboardBuilderModule {}
