import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { SiteSegmentViewsController } from "./segment-views.controller";
import { SiteSegmentViewsService } from "./segment-views.service";
import { OrgTrendPointsAdminController, SiteTrendPointsController } from "./trend-points.controller";
import { TrendPointsService } from "./trend-points.service";
import { SiteTrendStripController } from "./trend-strip.controller";
import { SiteTrendStripService } from "./trend-strip.service";

/**
 * `F4.300` / ADR 0108 decision 3 — the effective trend points per segment (the
 * site read) and an organization's override (the admin read and the
 * replace-all write) — and, since `F4.301` (ADR 0108 Amendment 2), the
 * Control Room trend strip's batch read; since `F4.302` (Amendment 4) the
 * Trends & Energy tab's segment view. The `ControlRoomModule` shape: `DatabaseModule` for the
 * fleet and tenant Drizzle tokens and the fleet pool, `AuthModule` for `AccessControlService`, and
 * a local `MasterDataAuditService` (stateless, so a second instance is not a
 * second copy of anything). Nothing is exported — only this module's four
 * controllers inject its services.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    SiteTrendPointsController,
    OrgTrendPointsAdminController,
    SiteTrendStripController,
    SiteSegmentViewsController,
  ],
  providers: [TrendPointsService, MasterDataAuditService, SiteTrendStripService, SiteSegmentViewsService],
})
export class TrendPointsModule {}
