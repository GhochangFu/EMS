import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DashboardBuilderModule } from "../dashboard-builder/dashboard-builder.module";
import { DatabaseModule } from "../database/database.module";
import { GeneratedSiteViewController } from "./generated-site-view.controller";
import { GeneratedSiteViewService } from "./generated-site-view.service";
import { OrganizationLayoutService } from "./organization-layout.service";
import { OrganizationViewController } from "./organization-view.controller";
import { SiteControlRoomViewService } from "./site-control-room-view.service";
import { SiteLayoutReplaceService } from "./site-layout-replace.service";
import { SiteLayoutService } from "./site-layout.service";
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
  // `F4.317` task 4.2 — `DashboardBuilderModule` for the `MetricCatalogService` it exports: the
  // organization strip resolves its tiles through the one catalog service.
  imports: [DatabaseModule, AuthModule, DashboardBuilderModule],
  // `F3.68` (ADR 0076 decision 7): the generated read sits beside the resolve
  // read that selects it. `GeneratedSiteViewService` is not exported — only
  // its own controller injects it.
  // `F4.317` (ADR 0112) — the organization strip's read and its two writes.
  controllers: [SiteViewController, GeneratedSiteViewController, OrganizationViewController],
  // `F3.73` plan D6 — `SiteLayoutService` (the site-layout copy action) is exported for the
  // three `AdminModule` doors: the location route, the `instantiate` site arm and the bulk route.
  // `F4.317` — `OrganizationLayoutService` is exported for `AdminModule`'s `instantiate`
  // organization arm (`ORGANIZATION_TEMPLATE_ARM`).
  // `F4.331` — `SiteLayoutReplaceService` (the Replace half, moved out for the 1000-line cap) is
  // exported for the four Replace doors on the same two `AdminModule` controllers.
  providers: [
    SiteControlRoomViewService,
    SiteLayoutService,
    SiteLayoutReplaceService,
    MasterDataAuditService,
    GeneratedSiteViewService,
    OrganizationLayoutService,
  ],
  exports: [SiteControlRoomViewService, SiteLayoutService, SiteLayoutReplaceService, OrganizationLayoutService],
})
export class ControlRoomModule {}
