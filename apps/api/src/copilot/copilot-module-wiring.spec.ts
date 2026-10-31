import "reflect-metadata";

import { expect } from "vitest";

import { AdminModule } from "../admin/admin.module";
import { OnboardingService } from "../admin/onboarding/onboarding.service";
import { UserGrantsService } from "../admin/users/user-grants.service";
import { UsersService } from "../admin/users/users.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { IDENTITY_ADMIN, IdentityAdminModule } from "../identity/identity-admin.module";
import { MimicLayoutsModule } from "../mimic-layouts/mimic-layouts.module";
import { MimicLayoutsService } from "../mimic-layouts/mimic-layouts.service";
import { CopilotPendingChangesService } from "./copilot-pending-changes.service";
import { CopilotProposeToolSet } from "./copilot-propose-tools";
import { COPILOT_ONBOARDING_SKILL } from "./copilot-onboarding-skill";
import { CopilotSkillService } from "./copilot-skill.service";
import { CopilotTargetResolver } from "./copilot-target-resolver";
import { CopilotTurnService } from "./copilot-turn.service";
import { CopilotModule } from "./copilot.module";
import { RuleProposalCheckService } from "../rules/rule-proposal-check.service";
import { RulesModule } from "../rules/rules.module";
import { RulesService } from "../rules/rules.service";
import { EscalationProfilesService } from "../notifications/escalation-profiles.service";
import { NotificationProposalCheckService } from "../notifications/notification-proposal-check.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReportProposalCheckService } from "../reports/report-proposal-check.service";
import { ReportSchedulesService } from "../reports/report-schedules.service";
import { ReportsModule } from "../reports/reports.module";
import { MaintenanceModule } from "../maintenance/maintenance.module";
import { MaintenanceService } from "../maintenance/maintenance.service";
import { WorkOrdersModule } from "../work-orders/work-orders.module";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { CopilotReadToolSet } from "./tools/copilot-read-tool-set";
import { TelemetryProposalCheckService } from "../admin/telemetry-entry/telemetry-proposal-check.service";
import { AssetImagesWriteService } from "../assets/asset-images-write.service";
import { AssetsModule } from "../assets/assets.module";
import { AuthModule } from "../auth/auth.module";
import { LocationAssetScopeService } from "../auth/location-asset-scope.service";
import { AlarmsModule } from "../alarms/alarms.module";
import { AlarmStatsService } from "../alarms/alarm-stats.service";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { LocationSummaryService } from "../reports/location-summary.service";
import { ReportsCoreModule } from "../reports/reports-core.module";
import { SitePointInventoryService } from "../rules/site-point-inventory.service";

/**
 * `F3.86` PR 4 / ADR 0099 decision 3 — the module edges a green build does not
 * prove. The resolver's user targets call `UsersService` and
 * `UserGrantsService`; `CopilotModule` provides both and imports
 * `IdentityAdminModule` for `UsersService`'s `IDENTITY_ADMIN`. Remove the
 * import and the API does not boot while every spec stays green (esbuild
 * emits no `design:paramtypes`, so no spec resolves a class-typed parameter).
 *
 * The control-room wiring spec's method: read what Nest reads at boot — the
 * `@Module()` metadata and each class's `self:paramtypes` (`@Inject`
 * tokens). Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const SELF_DECLARED_DEPS = "self:paramtypes";

function moduleList(module: object, key: "imports" | "providers" | "exports"): unknown[] {
  const raw = Reflect.getMetadata(key, module) as unknown[] | undefined;
  return (raw ?? []).map((entry) =>
    typeof entry === "object" && entry !== null && "provide" in entry ? (entry as { provide: unknown }).provide : entry,
  );
}

function injected(target: object): Map<number, unknown> {
  const raw = (Reflect.getMetadata(SELF_DECLARED_DEPS, target) as { index: number; param: unknown }[] | undefined) ?? [];
  return new Map(raw.map((entry) => [entry.index, entry.param]));
}

/** The resolver's third and fourth parameters are the two users services, by `@Inject`. */
export function assertTheResolverInjectsTheUsersServices(): void {
  const deps = injected(CopilotTargetResolver);
  expect(deps.get(2)).toBe(UsersService);
  expect(deps.get(3)).toBe(UserGrantsService);
}

/** `CopilotModule` provides both services and what they need beyond `AuthModule`. */
export function assertTheModuleProvidesTheUsersServices(): void {
  const providers = moduleList(CopilotModule, "providers");
  for (const provider of [UsersService, UserGrantsService, MasterDataAuditService, CopilotTargetResolver]) {
    expect(providers, provider.name).toContain(provider);
  }
}

/** `UsersService` injects `IDENTITY_ADMIN`; `CopilotModule` imports the module that exports it. */
export function assertTheIdentityAdminTokenResolves(): void {
  expect([...injected(UsersService).values()]).toContain(IDENTITY_ADMIN);
  expect(moduleList(IdentityAdminModule, "exports")).toContain(IDENTITY_ADMIN);
  expect(moduleList(CopilotModule, "imports")).toContain(IdentityAdminModule);
}

/** `F3.86` PR 5: `COPILOT_ONBOARDING_SKILL` is `OnboardingService` itself, from `AdminModule`, which exports it. */
export function assertTheOnboardingSkillIsTheOnboardingService(): void {
  const raw = (Reflect.getMetadata("providers", CopilotModule) as unknown[]) ?? [];
  const binding = raw.find(
    (entry) => typeof entry === "object" && entry !== null && "provide" in entry && (entry as { provide: unknown }).provide === COPILOT_ONBOARDING_SKILL,
  ) as { useExisting?: unknown } | undefined;
  expect(binding?.useExisting).toBe(OnboardingService);
  expect(moduleList(CopilotModule, "providers")).toContain(CopilotSkillService);
  expect(moduleList(CopilotModule, "imports")).toContain(AdminModule);
  expect(moduleList(AdminModule, "exports")).toContain(OnboardingService);
}

/** `F3.86` PR 5: the turn service and the skill service inject the seam by token (the controller's class-typed parameters carry none: `copilot-conversations.controller.spec.ts`). */
export function assertTheSkillSeamIsInjectedByToken(): void {
  expect([...injected(CopilotTurnService).values()]).toContain(COPILOT_ONBOARDING_SKILL);
  expect([...injected(CopilotSkillService).values()]).toContain(COPILOT_ONBOARDING_SKILL);
}

/**
 * `F3.87` PR 5: the propose tool set injects `MimicLayoutsService` by
 * `@Inject` (its third parameter), and `CopilotModule` imports the module that
 * exports it. Without either, a layout proposal is refused at runtime while
 * every spec built over fakes stays green.
 */
export function assertTheProposeToolsInjectTheLayoutsService(): void {
  const deps = injected(CopilotProposeToolSet);
  expect(deps.get(1)).toBe(CopilotPendingChangesService);
  expect(deps.get(2)).toBe(MimicLayoutsService);
  expect(moduleList(CopilotModule, "imports")).toContain(MimicLayoutsModule);
  expect(moduleList(MimicLayoutsModule, "exports")).toContain(MimicLayoutsService);
}

/**
 * `F4.278` (ADR 0099 Amendment 8): the propose tool set's fourth parameter is
 * `RuleProposalCheckService`, by `@Inject`; without it a rule proposal is
 * refused at runtime while every spec over fakes stays green.
 */
export function assertTheProposeToolsInjectTheRuleCheck(): void {
  expect(injected(CopilotProposeToolSet).get(3)).toBe(RuleProposalCheckService);
}

/** `CopilotModule` imports `RulesModule`, which exports both rule services the copilot injects. */
export function assertTheModuleImportsTheRulesModule(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(RulesModule);
  expect(moduleList(RulesModule, "exports")).toEqual(expect.arrayContaining([RulesService, RuleProposalCheckService]));
}

/** `RulesService` audits through the funnel: its sixth parameter, provided by `RulesModule`. */
export function assertTheRulesServiceInjectsTheAuditFunnel(): void {
  expect(injected(RulesService).get(5)).toBe(MasterDataAuditService);
  expect(moduleList(RulesModule, "providers")).toContain(MasterDataAuditService);
}

/**
 * `F4.279` (ADR 0099 Amendment 8 D5): the propose tools' fifth parameter is
 * `NotificationProposalCheckService`, by `@Inject`; without it a notification
 * proposal is refused at runtime while every spec over fakes stays green.
 */
export function assertTheProposeToolsInjectTheNotificationCheck(): void {
  expect(injected(CopilotProposeToolSet).get(4)).toBe(NotificationProposalCheckService);
}

/** `CopilotModule` imports `NotificationsModule`. */
export function assertTheModuleImportsTheNotificationsModule(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(NotificationsModule);
}

/** `NotificationsModule` exports the check and the profile service the copilot injects. */
export function assertTheNotificationsModuleExportsTheCopilotServices(): void {
  expect(moduleList(NotificationsModule, "exports")).toEqual(
    expect.arrayContaining([NotificationProposalCheckService, EscalationProfilesService]),
  );
}

/** `EscalationProfilesService` audits through the funnel: its fifth parameter, provided by `NotificationsModule`. */
export function assertTheEscalationServiceInjectsTheAuditFunnel(): void {
  expect(injected(EscalationProfilesService).get(4)).toBe(MasterDataAuditService);
  expect(moduleList(NotificationsModule, "providers")).toContain(MasterDataAuditService);
}

/**
 * `F4.280` (ADR 0099 Amendment 8 D2, D5): the propose tools' sixth parameter is
 * `ReportProposalCheckService`, by `@Inject`; without it a report proposal is refused at
 * runtime while every spec over fakes stays green.
 */
export function assertTheProposeToolsInjectTheReportCheck(): void {
  expect(injected(CopilotProposeToolSet).get(5)).toBe(ReportProposalCheckService);
}

/** `CopilotModule` imports `ReportsModule`. */
export function assertTheModuleImportsTheReportsModule(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(ReportsModule);
}

/** `ReportsModule` exports the check and the schedule service the copilot injects. */
export function assertTheReportsModuleExportsTheCopilotServices(): void {
  expect(moduleList(ReportsModule, "exports")).toEqual(expect.arrayContaining([ReportProposalCheckService, ReportSchedulesService]));
}

/** `F4.281` (Amendment 8 D7): `CopilotModule` imports `MaintenanceModule`. */
export function assertTheModuleImportsTheMaintenanceModule(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(MaintenanceModule);
}

/** `MaintenanceModule` exports the service `list_maintenance_schedules` reads through. */
export function assertTheMaintenanceModuleExportsItsService(): void {
  expect(moduleList(MaintenanceModule, "exports")).toContain(MaintenanceService);
}

/** The read tools' slot 21 is `MaintenanceService`, by `@Inject`. */
export function assertTheReadToolsInjectTheMaintenanceService(): void {
  expect(injected(CopilotReadToolSet).get(21)).toBe(MaintenanceService);
}

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18–Q21): the propose tools' seventh and eighth parameters
 * are `TelemetryProposalCheckService` and `AssetImagesWriteService`, by `@Inject`; without
 * them a file-data proposal is refused at runtime while every spec over fakes stays green.
 */
export function assertTheProposeToolsInjectTheTelemetryCheck(): void {
  expect(injected(CopilotProposeToolSet).get(6)).toBe(TelemetryProposalCheckService);
}

export function assertTheProposeToolsInjectTheImageWriteService(): void {
  expect(injected(CopilotProposeToolSet).get(7)).toBe(AssetImagesWriteService);
}

/** `AdminModule` exports the telemetry check. */
export function assertTheAdminModuleExportsTheTelemetryCheck(): void {
  expect(moduleList(AdminModule, "exports")).toContain(TelemetryProposalCheckService);
}

/** `AssetsModule` exports the image write service. */
export function assertTheAssetsModuleExportsTheImageWriteService(): void {
  expect(moduleList(AssetsModule, "exports")).toContain(AssetImagesWriteService);
}

/** `F4.284` (ADR 0106; owner ruling DC7): `CopilotModule` imports `WorkOrdersModule`, which exports its service. */
export function assertTheModuleImportsTheWorkOrdersModule(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(WorkOrdersModule);
  expect(moduleList(WorkOrdersModule, "exports")).toContain(WorkOrdersService);
}

/** The read tools' slot 22 is `WorkOrdersService` and slot 23 `UsersService`, by `@Inject` (DC1, DC7). */
export function assertTheReadToolsInjectTheWorkOrdersAndUsersServices(): void {
  expect([injected(CopilotReadToolSet).get(22), injected(CopilotReadToolSet).get(23)]).toEqual([WorkOrdersService, UsersService]);
}

/** `F4.284` (ADR 0106 decision 7): `WorkOrdersModule` provides the audit funnel its service injects. */
export function assertTheWorkOrdersModuleProvidesTheAuditFunnel(): void {
  expect(moduleList(WorkOrdersModule, "providers")).toContain(MasterDataAuditService);
}

/**
 * `F4.291` (owner ruling P5): `AuthModule` provides and exports the location → readable-assets
 * helper. It is `@Global()`, so the read tools (and `F4.288` / `F4.290`) resolve it with no import.
 */
export function assertTheAuthModuleExportsTheLocationScope(): void {
  expect(moduleList(AuthModule, "providers")).toContain(LocationAssetScopeService);
  expect(moduleList(AuthModule, "exports")).toContain(LocationAssetScopeService);
}

/** `F4.291`: the read tools' slot 24 is `LocationAssetScopeService`, by `@Inject`. */
export function assertTheReadToolsInjectTheLocationScope(): void {
  expect(injected(CopilotReadToolSet).get(24)).toBe(LocationAssetScopeService);
}

/** `F4.291` PR 2: `AlarmsModule` (imported by `CopilotModule`) provides and exports `AlarmStatsService`. */
export function assertTheAlarmsModuleExportsTheAlarmStats(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(AlarmsModule);
  expect(moduleList(AlarmsModule, "providers")).toContain(AlarmStatsService);
  expect(moduleList(AlarmsModule, "exports")).toContain(AlarmStatsService);
}

/** `F4.291` PR 2: the read tools' slot 25 is `AlarmStatsService`, by `@Inject`. */
export function assertTheReadToolsInjectTheAlarmStats(): void {
  expect(injected(CopilotReadToolSet).get(25)).toBe(AlarmStatsService);
}

/** `F4.288`: `RulesModule` (imported by `CopilotModule`) provides and exports `SitePointInventoryService`. */
export function assertTheRulesModuleExportsTheInventoryService(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(RulesModule);
  expect(moduleList(RulesModule, "providers")).toContain(SitePointInventoryService);
  expect(moduleList(RulesModule, "exports")).toContain(SitePointInventoryService);
}

/** `F4.288`: the read tools' slot 26 is `SitePointInventoryService`, by `@Inject`. */
export function assertTheReadToolsInjectTheInventoryService(): void {
  expect(injected(CopilotReadToolSet).get(26)).toBe(SitePointInventoryService);
}

/**
 * `F4.288` (the plan critic's defect 6): the service's own one slot is the fleet pool, by
 * `@Inject` — without it the API does not boot while every other spec stays green.
 */
export function assertTheInventoryServiceInjectsTheFleetPool(): void {
  expect([...injected(SitePointInventoryService)]).toEqual([[0, FLEET_DRIZZLE]]);
}

/** `F4.290` PR 2: `ReportsCoreModule` (imported by `CopilotModule`) provides and exports `LocationSummaryService`. */
export function assertTheReportsCoreModuleExportsTheLocationSummary(): void {
  expect(moduleList(CopilotModule, "imports")).toContain(ReportsCoreModule);
  expect(moduleList(ReportsCoreModule, "providers")).toContain(LocationSummaryService);
  expect(moduleList(ReportsCoreModule, "exports")).toContain(LocationSummaryService);
}

/** `F4.290` PR 2: the read tools' slot 27 is `LocationSummaryService`, by `@Inject`. */
export function assertTheReadToolsInjectTheLocationSummary(): void {
  expect(injected(CopilotReadToolSet).get(27)).toBe(LocationSummaryService);
}

/** `F4.290` PR 2: the service's two slots are the fleet handles, by `@Inject` — without them the API does not boot. */
export function assertTheLocationSummaryInjectsTheFleetHandles(): void {
  const slots = injected(LocationSummaryService);
  expect([slots.size, slots.get(0), slots.get(1)]).toEqual([2, FLEET_DRIZZLE, FLEET_POOL]);
}
