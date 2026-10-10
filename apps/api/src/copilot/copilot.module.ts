import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { CopilotAccessController } from "./copilot-access.controller";
import { CopilotAccessGuard } from "./copilot-access.guard";
import { CopilotAccessService } from "./copilot-access.service";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotChangeInterceptor } from "./copilot-change.interceptor";
import { CopilotContextMiddleware } from "./copilot-context.middleware";
import { CopilotConversationsController } from "./copilot-conversations.controller";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
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
 *
 * PR 4 (decision 4.5) adds the seam every confirmed change passes through:
 * `CopilotChangeInterceptor` as a global interceptor (`APP_INTERCEPTOR`), and
 * `CopilotContextMiddleware` on every route (`configure`, the
 * `ObservabilityModule` form), which opens the per-request store the
 * interceptor marks and `MasterDataAuditService` reads.
 * `tests/f3.85-copilot-interceptor-wiring.test.ts` pins both registrations.
 *
 * PR 5 adds the history routes (`CopilotConversationsController`), guarded at
 * the controller by `JwtAuthGuard` and `CopilotAccessGuard` (never global).
 * The queries live in `CopilotConversationsService`, exported for the turn
 * service PR 7 adds, so history is read and written through one place.
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CopilotAccessController, CopilotConversationsController, CopilotStatusController],
  providers: [
    CopilotAccessGuard,
    CopilotAccessService,
    CopilotAvailabilityService,
    CopilotConversationsService,
    CopilotPendingChangesService,
    MasterDataAuditService,
    { provide: APP_INTERCEPTOR, useClass: CopilotChangeInterceptor },
  ],
  exports: [CopilotAvailabilityService, CopilotConversationsService, CopilotPendingChangesService],
})
export class CopilotModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CopilotContextMiddleware).forRoutes("*");
  }
}
