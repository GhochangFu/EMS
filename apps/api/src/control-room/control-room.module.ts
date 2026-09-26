import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { GeneratedSiteViewController } from "./generated-site-view.controller";
import { GeneratedSiteViewService } from "./generated-site-view.service";
import { SiteControlRoomViewService } from "./site-control-room-view.service";
import { SiteViewController } from "./site-view.controller";

/**
 * `F3.67` U4 / ADR 0076 decision 5 (plan D4) — the per-site Control Room view
 * setting: the resolve read (`SiteViewController`) this module owns, plus the
 * service `AdminModule` imports for the two `LocationsAdminController` write
 * handlers.
 *
 * Follows `DashboardBuilderModule`'s shape: `DatabaseModule` for the
 * tenant/fleet Drizzle tokens `SiteControlRoomViewService` injects,
 * `AuthModule` for `AccessControlService`. `MasterDataAuditService` is
 * provided here rather than imported — it is stateless (reads its Drizzle
 * handles from `DatabaseModule`'s tokens on each call), so a second instance
 * is not a second copy of anything, matching how `AdminModule` and
 * `DashboardBuilderModule` each provide their own instance rather than
 * sharing one.
 *
 * `SiteControlRoomViewService` is exported (plan D4's explicit choice) rather
 * than re-provided in `AdminModule`: this module owns the write path (`getSetting`/
 * `putSetting`, including the `builtin`-is-admin-only checks, OQ1 and OQ3) and the
 * resolve read that consumes the same stored row, so `LocationsAdminController`
 * injects the one instance this module already assembles instead of `AdminModule`
 * wiring a second copy of the same constructor.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  // `F3.68` (ADR 0076 decision 7): the generated read sits beside the resolve
  // read that selects it. `GeneratedSiteViewService` is not exported — only
  // its own controller injects it.
  controllers: [SiteViewController, GeneratedSiteViewController],
  providers: [SiteControlRoomViewService, MasterDataAuditService, GeneratedSiteViewService],
  exports: [SiteControlRoomViewService],
})
export class ControlRoomModule {}
