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
});
