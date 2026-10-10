import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CopilotAccessController } from "./copilot-access.controller";
import { CopilotAccessService } from "./copilot-access.service";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotStatusController } from "./copilot-status.controller";

/**
 * `F3.85` / ADR 0099 — the administrator copilot. PR 3 holds availability:
 * the organization, role and user switches, and the status read the dock asks
 * on mount. Later PRs add the pending changes, history, usage limits, the turn
 * service and the catalog here.
 *
 * The `MimicLayoutsModule` shape: `DatabaseModule` for the Drizzle tokens,
 * `AuthModule` for `AccessControlService` and the guard, and its own
 * `MasterDataAuditService` (stateless). `CopilotAvailabilityService` is
 * exported for the turn service that later PRs add.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CopilotAccessController, CopilotStatusController],
  providers: [CopilotAccessService, CopilotAvailabilityService, MasterDataAuditService],
  exports: [CopilotAvailabilityService],
})
export class CopilotModule {}
