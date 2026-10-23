import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { AdminModule } from "../admin/admin.module";
import { LocationsAdminService } from "../admin/locations/locations.service";
import { OnboardingService } from "../admin/onboarding/onboarding.service";
import { UserGrantsService } from "../admin/users/user-grants.service";
import { UsersService } from "../admin/users/users.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AlarmKbModule } from "../alarm-kb/alarm-kb.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RulesModule } from "../rules/rules.module";
import { AlarmsModule } from "../alarms/alarms.module";
import { AssetHealthModule } from "../asset-health/asset-health.module";
import { AssetsModule } from "../assets/assets.module";
import { AuthModule } from "../auth/auth.module";
import { DashboardModule } from "../dashboard/dashboard.module";
import { DashboardBuilderModule } from "../dashboard-builder/dashboard-builder.module";
import { DatabaseModule } from "../database/database.module";
import { IdentityAdminModule } from "../identity/identity-admin.module";
import { LlmModule } from "../llm/llm.module";
import { MimicLayoutsModule } from "../mimic-layouts/mimic-layouts.module";
import { MimicSymbolLibrariesModule } from "../mimic-symbol-libraries/mimic-symbol-libraries.module";
import { ReportsCoreModule } from "../reports/reports-core.module";
import { SystemStatusModule } from "../system-status/system-status.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";
import { CopilotAccessController } from "./copilot-access.controller";
import { CopilotAccessGuard } from "./copilot-access.guard";
import { CopilotAccessService } from "./copilot-access.service";
import { CopilotAvailabilityService } from "./copilot-availability.service";
import { CopilotChangeInterceptor } from "./copilot-change.interceptor";
import { CopilotChangesController } from "./copilot-changes.controller";
import { COPILOT_USAGE_LIMITS, readCopilotUsageLimits } from "./copilot-config";
import { CopilotContextMiddleware } from "./copilot-context.middleware";
import { CopilotConversationsController } from "./copilot-conversations.controller";
import { CopilotConversationsService } from "./copilot-conversations.service";
import { CopilotOnboardingCommitReader } from "./copilot-onboarding-commit";
import { COPILOT_ONBOARDING_SKILL } from "./copilot-onboarding-skill";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { CopilotSkillService } from "./copilot-skill.service";
import { COPILOT_PROPOSE_TOOLS, CopilotProposeToolSet } from "./copilot-propose-tools";
import { COPILOT_READ_TOOLS } from "./copilot-read-tools";
import { CopilotStatusController } from "./copilot-status.controller";
import { COPILOT_TARGETS, CopilotTargetResolver } from "./copilot-target-resolver";
import { CopilotTurnService } from "./copilot-turn.service";
import { CopilotUsageService } from "./copilot-usage.service";
import { CopilotReadToolSet } from "./tools/copilot-read-tool-set";

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
 *
 * PR 6 adds `CopilotUsageService` (the daily turn limits, Amendment 1 A1/A2),
 * exported for the turn service, and its limits read once from the environment
 * through the `COPILOT_USAGE_LIMITS` token.
 *
 * PR 7 adds `CopilotTurnService` (the read-only turn, decisions 1, 9, 10, 11)
 * and imports `LlmModule` for `LlmResolver`. The read tools reach it through
 * the `COPILOT_READ_TOOLS` token (`copilot-read-tools.ts` states the seam).
 *
 * The token is bound to `CopilotReadToolSet` (`tools/`), which calls each
 * read through the service that owns it: `AlarmsService` (`AlarmsModule`,
 * exported — it holds the socket gateway, so it is never provided twice),
 * `AssetsService` and `AssetKpisService` (`AssetsModule`, exported),
 * `DashboardsService` (`DashboardBuilderModule`, exported) and
 * `AssetHealthService` (`AssetHealthModule` already exports it).
 * `LocationsAdminService` is provided here rather than exported from
 * `AdminModule`: it is stateless the way `MasterDataAuditService` is (its
 * handles come from `DatabaseModule`'s tokens), and it needs only
 * `VocabulariesModule` beyond what this module has. None of those modules
 * imports this one, so the graph stays acyclic.
 *
 * PR 8 adds the action catalog's server side (decisions 2, 4): the propose
 * tools behind `COPILOT_PROPOSE_TOOLS` (`CopilotProposeToolSet`), which store a
 * pending change and never write it; `CopilotTargetResolver` behind
 * `COPILOT_TARGETS`, which reads a target inside the turn's allowed set with
 * `AccessControlService`'s manage checks; and `CopilotChangesController`, the
 * Reject button's route. The interceptor starts the follow-up turn
 * (`CopilotTurnService.followUp`) after it records an outcome.
 *
 * `F3.86` PR 4: the resolver's user targets call `UsersService` and
 * `UserGrantsService` (ADR 0089's checks, never a copy). Both are provided
 * here the way `LocationsAdminService` is — their handles come from
 * `DatabaseModule`'s tokens — and `IdentityAdminModule` gives `UsersService`
 * its `IDENTITY_ADMIN` (the resolver never calls Keycloak). Neither module
 * imports this one.
 *
 * `F3.86` PR 5 (decision 7): the onboarding skill. `AdminModule` exports
 * `OnboardingService` and this module imports it, so the skill runs the one
 * onboarding provider tree; `COPILOT_ONBOARDING_SKILL` narrows it to the three
 * methods the copilot calls. `AdminModule`'s imports (vocabularies, calc,
 * control room, identity, LLM) never reach this module, and the worker never
 * reaches either (`CopilotPurgeModule` is the worker's leaf), so the graph
 * stays acyclic. `CopilotSkillService` starts, ends and reads the skill.
 *
 * `F3.87` PR 2 (ADR 0099 Amendment 3): `MimicLayoutsModule` and
 * `MimicSymbolLibrariesModule` export their services for the mimic read tools
 * and the layout proposal check. Neither imports this module.
 *
 * `F4.274`: `TelemetryModule` exports `TelemetryService` for the telemetry
 * read tools; it imports nothing of this module, so the graph stays acyclic.
 *
 * `F4.275`: `DashboardModule` exports `DashboardService` and
 * `ReportsCoreModule` exports `ReportsService` for the energy and portfolio
 * read tools. `ReportsCoreModule`, not `ReportsModule`, which mounts the
 * report controllers. Neither imports this module; `DashboardModule` ->
 * `CalcModule` -> `TelemetryModule` is already in this module's graph.
 *
 * `F4.277`: `AdminModule` (already imported) exports `AuditAdminService` and
 * `SystemStatusModule` exports `SystemStatusService` for the audit-log and
 * system-status read tools. `SystemStatusModule` imports only `AuthModule`,
 * and stays API-only: the worker never reaches this module.
 *
 * `F4.276`: `AlarmsModule` (already imported) exports `AlarmDetailsService`
 * and `AlarmKbModule` exports `AlarmKbService` for the alarm details and the
 * alarm knowledge-base read tools. `AlarmKbModule` declares no imports, so the
 * graph stays acyclic; the worker never reaches this module.
 *
 * `F4.278` (ADR 0099 Amendment 8): `RulesModule` exports `RulesService` for the
 * `list_rules` read tool and `RuleProposalCheckService` for the rule proposal
 * check. Its imports (vocabularies, alarms, notifications) never import this
 * module, so the graph stays acyclic; the worker's `RuleSweepModule` does not
 * import `RulesModule`.
 *
 * `F4.279` (ADR 0099 Amendment 8): `NotificationsModule` exports
 * `NotificationProposalCheckService` for the notification proposal check and
 * `EscalationProfilesService` (with `ChannelsService` through the core) for the
 * two notification read tools. It imports only `NotificationsCoreModule`, never
 * this module, so the graph stays acyclic; the worker imports the core alone.
 */
@Module({
  imports: [
    MimicLayoutsModule,
    MimicSymbolLibrariesModule,
    AdminModule,
    DatabaseModule,
    AuthModule,
    IdentityAdminModule,
    LlmModule,
    AlarmsModule,
    AssetsModule,
    AssetHealthModule,
    DashboardBuilderModule,
    VocabulariesModule,
    TelemetryModule,
    DashboardModule,
    ReportsCoreModule,
    SystemStatusModule,
    AlarmKbModule,
    RulesModule,
    NotificationsModule,
  ],
  controllers: [CopilotAccessController, CopilotChangesController, CopilotConversationsController, CopilotStatusController],
  providers: [
    CopilotAccessGuard,
    CopilotAccessService,
    CopilotAvailabilityService,
    CopilotConversationsService,
    CopilotPendingChangesService,
    CopilotUsageService,
    CopilotTurnService,
    LocationsAdminService,
    UsersService,
    UserGrantsService,
    CopilotReadToolSet,
    { provide: COPILOT_READ_TOOLS, useExisting: CopilotReadToolSet },
    CopilotTargetResolver,
    { provide: COPILOT_TARGETS, useExisting: CopilotTargetResolver },
    CopilotProposeToolSet,
    { provide: COPILOT_PROPOSE_TOOLS, useExisting: CopilotProposeToolSet },
    { provide: COPILOT_ONBOARDING_SKILL, useExisting: OnboardingService },
    // `F3.86` PR 6: reads the stored commit proposal for the server-made `onboarding.commit` card.
    CopilotOnboardingCommitReader,
    CopilotSkillService,
    { provide: COPILOT_USAGE_LIMITS, useFactory: () => readCopilotUsageLimits(process.env) },
    MasterDataAuditService,
    { provide: APP_INTERCEPTOR, useClass: CopilotChangeInterceptor },
  ],
  exports: [CopilotAvailabilityService, CopilotConversationsService, CopilotPendingChangesService, CopilotUsageService],
})
export class CopilotModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CopilotContextMiddleware).forRoutes("*");
  }
}
