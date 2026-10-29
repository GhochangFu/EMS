import { describe, it } from "vitest";

import {
  assertTheIdentityAdminTokenResolves,
  assertTheOnboardingSkillIsTheOnboardingService,
  assertTheSkillSeamIsInjectedByToken,
  assertTheModuleImportsTheRulesModule,
  assertTheModuleProvidesTheUsersServices,
  assertTheProposeToolsInjectTheRuleCheck,
  assertTheRulesServiceInjectsTheAuditFunnel,
  assertTheEscalationServiceInjectsTheAuditFunnel,
  assertTheModuleImportsTheNotificationsModule,
  assertTheNotificationsModuleExportsTheCopilotServices,
  assertTheProposeToolsInjectTheNotificationCheck,
  assertTheProposeToolsInjectTheReportCheck,
  assertTheModuleImportsTheReportsModule,
  assertTheAdminModuleExportsTheTelemetryCheck,
  assertTheAssetsModuleExportsTheImageWriteService,
  assertTheProposeToolsInjectTheImageWriteService,
  assertTheProposeToolsInjectTheTelemetryCheck,
  assertTheReportsModuleExportsTheCopilotServices,
  assertTheMaintenanceModuleExportsItsService,
  assertTheModuleImportsTheMaintenanceModule,
  assertTheReadToolsInjectTheMaintenanceService,
  assertTheModuleImportsTheWorkOrdersModule,
  assertTheReadToolsInjectTheWorkOrdersAndUsersServices,
  assertTheWorkOrdersModuleProvidesTheAuditFunnel,
  assertTheAuthModuleExportsTheLocationScope,
  assertTheReadToolsInjectTheLocationScope,
  assertTheAlarmsModuleExportsTheAlarmStats,
  assertTheReadToolsInjectTheAlarmStats,
  assertTheRulesModuleExportsTheInventoryService,
  assertTheReadToolsInjectTheInventoryService,
  assertTheInventoryServiceInjectsTheFleetPool,
  assertTheProposeToolsInjectTheLayoutsService,
  assertTheResolverInjectsTheUsersServices,
} from "./copilot-module-wiring.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 4 — CopilotModule wiring for the user targets", () => {
  it("the resolver injects UsersService and UserGrantsService", () => assertTheResolverInjectsTheUsersServices());
  it("the module provides both services", () => assertTheModuleProvidesTheUsersServices());
  it("the module imports IdentityAdminModule for IDENTITY_ADMIN", () => assertTheIdentityAdminTokenResolves());
  it("F3.86 PR 5: binds the onboarding skill to OnboardingService from AdminModule", () => assertTheOnboardingSkillIsTheOnboardingService());
  it("F3.86 PR 5: injects the skill seam by token", () => assertTheSkillSeamIsInjectedByToken());
  it("F3.87 PR 5: the propose tools inject MimicLayoutsService from MimicLayoutsModule", () =>
    assertTheProposeToolsInjectTheLayoutsService());
  it("F4.278: the propose tools inject RuleProposalCheckService", () => assertTheProposeToolsInjectTheRuleCheck());
  it("F4.278: the module imports RulesModule, which exports both rule services", () => assertTheModuleImportsTheRulesModule());
  it("F4.278: RulesService injects MasterDataAuditService, provided by RulesModule", () =>
    assertTheRulesServiceInjectsTheAuditFunnel());
  it("F4.279: the propose tools inject NotificationProposalCheckService", () => assertTheProposeToolsInjectTheNotificationCheck());
  it("F4.279: the module imports NotificationsModule", () => assertTheModuleImportsTheNotificationsModule());
  it("F4.279: NotificationsModule exports the check and EscalationProfilesService", () =>
    assertTheNotificationsModuleExportsTheCopilotServices());
  it("F4.279: EscalationProfilesService injects MasterDataAuditService, provided by NotificationsModule", () =>
    assertTheEscalationServiceInjectsTheAuditFunnel());
  it("F4.280: the propose tools inject ReportProposalCheckService", () => assertTheProposeToolsInjectTheReportCheck());
  it("F4.280: the module imports ReportsModule", () => assertTheModuleImportsTheReportsModule());
  it("F4.283: the propose tools inject the telemetry check at slot 6", () => assertTheProposeToolsInjectTheTelemetryCheck());
  it("F4.283: the propose tools inject AssetImagesWriteService at slot 7", () => assertTheProposeToolsInjectTheImageWriteService());
  it("F4.283: AdminModule exports the telemetry check", () => assertTheAdminModuleExportsTheTelemetryCheck());
  it("F4.283: AssetsModule exports AssetImagesWriteService", () => assertTheAssetsModuleExportsTheImageWriteService());
  it("F4.280: ReportsModule exports the check and ReportSchedulesService", () =>
    assertTheReportsModuleExportsTheCopilotServices());
  it("F4.281: the module imports MaintenanceModule", () => assertTheModuleImportsTheMaintenanceModule());
  it("F4.281: MaintenanceModule exports MaintenanceService", () => assertTheMaintenanceModuleExportsItsService());
  it("F4.281: the read tools inject MaintenanceService in slot 21", () => assertTheReadToolsInjectTheMaintenanceService());
  it("F4.284: CopilotModule imports WorkOrdersModule, which exports its service", () => assertTheModuleImportsTheWorkOrdersModule());
  it("F4.284: the read tools inject WorkOrdersService and UsersService in slots 22 and 23", () =>
    assertTheReadToolsInjectTheWorkOrdersAndUsersServices());
  it("F4.284: WorkOrdersModule provides MasterDataAuditService", () => assertTheWorkOrdersModuleProvidesTheAuditFunnel());
  it("F4.291: AuthModule provides and exports LocationAssetScopeService", () => assertTheAuthModuleExportsTheLocationScope());
  it("F4.291: the read tools inject LocationAssetScopeService in slot 24", () => assertTheReadToolsInjectTheLocationScope());
  it("F4.291 PR 2: AlarmsModule provides and exports AlarmStatsService", () => assertTheAlarmsModuleExportsTheAlarmStats());
  it("F4.291 PR 2: the read tools inject AlarmStatsService in slot 25", () => assertTheReadToolsInjectTheAlarmStats());
  it("F4.288: RulesModule provides and exports SitePointInventoryService", () => assertTheRulesModuleExportsTheInventoryService());
  it("F4.288: the read tools inject SitePointInventoryService in slot 26", () => assertTheReadToolsInjectTheInventoryService());
  it("F4.288: SitePointInventoryService injects the fleet pool", () => assertTheInventoryServiceInjectsTheFleetPool());
});
