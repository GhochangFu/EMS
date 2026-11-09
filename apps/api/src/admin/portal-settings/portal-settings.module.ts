import { Module } from "@nestjs/common";

import { MeController } from "../../me/me.controller";
import { MasterDataAuditService } from "../master-data-audit.service";
import { PortalSettingsController } from "./portal-settings.controller";
import { PortalSettingsService } from "./portal-settings.service";
import { PublicAppearanceController } from "./public-appearance.controller";

/**
 * `F4.341` (ADR 0118 decisions 9–12) — the portal and user appearance routes. The organization
 * route stays on `OrganizationsAdminController`. `AccessControlService` and the drizzle tokens
 * come from the global modules.
 */
@Module({
  controllers: [PortalSettingsController, PublicAppearanceController, MeController],
  providers: [PortalSettingsService, MasterDataAuditService],
})
export class PortalSettingsModule {}
