import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { OrgTrendPointsAdminController, SiteTrendPointsController } from "./trend-points.controller";
import { TrendPointsService } from "./trend-points.service";

/**
 * `F4.300` / ADR 0108 decision 3 — the effective trend points per segment (the
 * site read) and an organization's override (the admin read and the
 * replace-all write). The `ControlRoomModule` shape: `DatabaseModule` for the
 * fleet and tenant Drizzle tokens, `AuthModule` for `AccessControlService`, and
 * a local `MasterDataAuditService` (stateless, so a second instance is not a
 * second copy of anything). Nothing is exported — only this module's two
 * controllers inject the service.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SiteTrendPointsController, OrgTrendPointsAdminController],
  providers: [TrendPointsService, MasterDataAuditService],
})
export class TrendPointsModule {}
