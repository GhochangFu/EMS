import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import { DatabaseModule } from "../database/database.module";
import { MimicLayoutPreviewService } from "./mimic-layout-preview.service";
import { MimicLayoutsController } from "./mimic-layouts.controller";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.32c` / ADR 0081 decision 3 — the mimic layout library.
 *
 * The `ControlRoomModule` shape: `DatabaseModule` for the tenant and fleet
 * Drizzle tokens, `AuthModule` for `AccessControlService`, and its own
 * `MasterDataAuditService` (stateless — it reads its Drizzle handles from
 * `DatabaseModule`'s tokens). The resolver reads the layout tables itself, on
 * its own pool. `F3.87` PR 2: the service is exported for `CopilotModule` — the
 * copilot's layout read tools and its read-only proposal check
 * (`validateProposal`, `missingRoleCodes`; ADR 0099 Amendment 3 A2).
 *
 * `F4.308` (plan C3, owner ruling Q4 a): the preview route's `MimicLayoutPreviewService`, and the
 * module's OWN stateless `MimicNodesService` (its tokens, `FLEET_DRIZZLE`, `FLEET_POOL` and
 * `AccessControlService`, are global) — the `TrendPointsService` idiom, so no
 * `DashboardBuilderModule` import and no cycle. `MimicLayoutsService` gains no dependency, so
 * `CopilotModule` is untouched; the export list is unchanged.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MimicLayoutsController],
  providers: [MimicLayoutsService, MasterDataAuditService, MimicLayoutPreviewService, MimicNodesService],
  exports: [MimicLayoutsService],
})
export class MimicLayoutsModule {}
