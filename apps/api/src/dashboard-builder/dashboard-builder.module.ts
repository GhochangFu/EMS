import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AssetHealthModule } from "../asset-health/asset-health.module";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { DashboardBuilderController } from "./dashboard-builder.controller";
import { DashboardsService } from "./dashboards.service";
import { MetricCatalogService } from "./metric-catalog.service";

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
/**
 * `AssetHealthModule` is imported for `F3.35` Stage C's `assets.health.score`, which delegates
 * to `AssetHealthService.summary(...)` rather than reimplementing ADR 0050's roll-up. It is a
 * whole-module import rather than a provider copy because `AssetHealthService` is not stateless
 * the way `MasterDataAuditService` is — it holds the window/level resolution `E1.3` owns, and a
 * second instance would be a second place that decides which rollup level a window maps to.
 */
@Module({
  imports: [DatabaseModule, AuthModule, AssetHealthModule],
  controllers: [DashboardBuilderController],
  providers: [DashboardsService, MetricCatalogService, MasterDataAuditService],
})
export class DashboardBuilderModule {}
