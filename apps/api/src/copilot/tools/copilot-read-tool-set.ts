import { Inject, Injectable } from "@nestjs/common";
import type { ZodTypeAny } from "zod";

import { AuditAdminService } from "../../admin/audit/audit.service";
import { LocationsAdminService } from "../../admin/locations/locations.service";
import { AlarmKbService } from "../../alarm-kb/alarm-kb.service";
import { AlarmDetailsService } from "../../alarms/alarm-details.service";
import { AlarmsService } from "../../alarms/alarms.service";
import { AssetHealthService } from "../../asset-health/asset-health.service";
import { AssetKpisService } from "../../assets/asset-kpis.service";
import { AssetsService } from "../../assets/assets.service";
import { AccessControlService } from "../../auth/access-control.service";
import { LocationAssetScopeService } from "../../auth/location-asset-scope.service";
import { DashboardService } from "../../dashboard/dashboard.service";
import { DashboardsService } from "../../dashboard-builder/dashboards.service";
import { MaintenanceService } from "../../maintenance/maintenance.service";
import { UsersService } from "../../admin/users/users.service";
import { WorkOrdersService } from "../../work-orders/work-orders.service";
import { defineToolRegistry, type ToolRegistry } from "../../llm/tool-registry";
import { MimicLayoutsService } from "../../mimic-layouts/mimic-layouts.service";
import { MimicSymbolLibrariesService } from "../../mimic-symbol-libraries/mimic-symbol-libraries.service";
import { ReportsService } from "../../reports/reports.service";
import { RulesService } from "../../rules/rules.service";
import { ChannelsService } from "../../notifications/channels.service";
import { EscalationProfilesService } from "../../notifications/escalation-profiles.service";
import { ReportSchedulesService } from "../../reports/report-schedules.service";
import { SystemStatusService } from "../../system-status/system-status.service";
import { TelemetryService } from "../../telemetry/telemetry.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { CopilotReadTools, CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices, CopilotReadToolDefinition } from "./copilot-read-tool";
import { getAlarmDetailsTool } from "./get-alarm-details.tool";
import { getAlarmKbTool } from "./get-alarm-kb.tool";
import { getAssetKpisTool } from "./get-asset-kpis.tool";
import { getDashboardKpisTool } from "./get-dashboard-kpis.tool";
import { getEnergyReportPreviewTool } from "./get-energy-report-preview.tool";
import { getEnergySourceMixTool } from "./get-energy-source-mix.tool";
import { getEnergySummaryTool } from "./get-energy-summary.tool";
import { getEnergyTopConsumersTool } from "./get-energy-top-consumers.tool";
import { getHealthSummaryTool } from "./get-health-summary.tool";
import { getLatestValuesTool } from "./get-latest-values.tool";
import { getLoadTrendTool } from "./get-load-trend.tool";
import { getMimicLayoutTool } from "./get-mimic-layout.tool";
import { getPointAggregateTool } from "./get-point-aggregate.tool";
import { getRecentValuesTool } from "./get-recent-values.tool";
import { getSystemStatusTool } from "./get-system-status.tool";
import { getValuesAtInstantTool } from "./get-values-at-instant.tool";
import { listAlarmSkillsTool } from "./list-alarm-skills.tool";
import { listAlarmsTool } from "./list-alarms.tool";
import { listAssetPointsTool } from "./list-asset-points.tool";
import { listAssetRolesTool } from "./list-asset-roles.tool";
import { listAssetsTool } from "./list-assets.tool";
import { listAuditLogTool } from "./list-audit-log.tool";
import { listDashboardsTool } from "./list-dashboards.tool";
import { listLocationsTool } from "./list-locations.tool";
import { listMimicLayoutsTool } from "./list-mimic-layouts.tool";
import { listMimicSymbolsTool } from "./list-mimic-symbols.tool";
import { listRulesTool } from "./list-rules.tool";
import { listNotificationChannelsTool } from "./list-notification-channels.tool";
import { listEscalationProfilesTool } from "./list-escalation-profiles.tool";
import { listMaintenanceSchedulesTool } from "./list-maintenance-schedules.tool";
import { listUsersTool } from "./list-users.tool";
import { listWorkOrdersTool } from "./list-work-orders.tool";
import { listReportSchedulesTool } from "./list-report-schedules.tool";
import { openPageTool } from "./open-page.tool";

/**
 * The read tools, in the order the model sees them. No tool here writes.
 * `F3.87` PR 2 adds the four mimic reads (ADR 0099 Amendment 3 drafter choice
 * 1, plan D16) before `open_page`. `F4.274` adds the five telemetry reads
 * after `get_asset_kpis`. `F4.275` adds the six energy and portfolio reads
 * after `get_point_aggregate`. `F4.277` adds `get_system_status` and
 * `list_audit_log` after `get_health_summary`. `F4.276` adds
 * `get_alarm_details` and `get_alarm_kb` after `list_alarms`.
 */
export const COPILOT_READ_TOOL_DEFINITIONS: readonly CopilotReadToolDefinition[] = [
  listAlarmsTool,
  getAlarmDetailsTool,
  getAlarmKbTool,
  listAssetsTool,
  getAssetKpisTool,
  listAssetPointsTool,
  getLatestValuesTool,
  getValuesAtInstantTool,
  getRecentValuesTool,
  getPointAggregateTool,
  getDashboardKpisTool,
  getLoadTrendTool,
  getEnergySummaryTool,
  getEnergySourceMixTool,
  getEnergyTopConsumersTool,
  getEnergyReportPreviewTool,
  listLocationsTool,
  listDashboardsTool,
  getHealthSummaryTool,
  getSystemStatusTool,
  listAuditLogTool,
  listMimicLayoutsTool,
  getMimicLayoutTool,
  listMimicSymbolsTool,
  listAssetRolesTool,
  // `F4.278` (Amendment 8 D7): after the unit roles, before `open_page`.
  listRulesTool,
  // `F4.279` (Amendment 8 D7): after the rules, before `open_page`.
  listNotificationChannelsTool,
  listEscalationProfilesTool,
  // `F4.280` (Amendment 8 D7, Q1): after the escalation profiles, before `open_page`.
  listReportSchedulesTool,
  // `F4.281` (Amendment 8 D7, owner ruling DC4): after the report schedules, before `open_page`.
  listMaintenanceSchedulesTool,
  // `F4.284` (ADR 0106; owner rulings DC1, DC7): the ids a work-order change names, and its assignee.
  listWorkOrdersTool,
  listUsersTool,
  // `F4.284` owner ruling 2026-10-25 (Q4): the skill codes an alarm analysis may name.
  listAlarmSkillsTool,
  openPageTool,
];

/**
 * The read tools over a set of services. The turn service owns the argument
 * guards, the result scrub, the out-of-scope check and the provenance
 * (`copilot-read-tools.ts`); this owns the per-tool organization rules.
 */
export function createCopilotReadTools(services: CopilotReadServices): CopilotReadTools {
  const byName = new Map(COPILOT_READ_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  const schemas: Record<string, ZodTypeAny> = {};
  const descriptions: Record<string, string> = {};
  for (const tool of COPILOT_READ_TOOL_DEFINITIONS) {
    schemas[tool.name] = tool.schema;
    descriptions[tool.name] = tool.description;
  }
  const registry: ToolRegistry<string> = defineToolRegistry<string>(schemas, descriptions);
  return {
    registry,
    dispatch: async (name, args, ctx): Promise<CopilotToolResult> => {
      const tool = byName.get(name);
      if (tool === undefined) return { ok: false, error: "No such tool." };
      return tool.run(services, args, ctx);
    },
  };
}

/**
 * `F3.85` PR 7 / ADR 0099 decisions 1, 10 — the read tools as the Nest
 * provider behind `COPILOT_READ_TOOLS`. Each service comes from the module
 * that owns it (`copilot.module.ts` states which).
 */
@Injectable()
export class CopilotReadToolSet implements CopilotReadTools {
  private readonly tools: CopilotReadTools;

  // Each slot names its class with `@Inject`, so the wiring spec can read the
  // tokens (`self:paramtypes`) without the compiler's `design:paramtypes`.
  constructor(
    @Inject(AccessControlService) access: AccessControlService,
    @Inject(AlarmsService) alarms: AlarmsService,
    @Inject(AssetsService) assets: AssetsService,
    @Inject(AssetKpisService) kpis: AssetKpisService,
    @Inject(LocationsAdminService) locations: LocationsAdminService,
    @Inject(DashboardsService) dashboards: DashboardsService,
    @Inject(AssetHealthService) health: AssetHealthService,
    @Inject(MimicLayoutsService) layouts: MimicLayoutsService,
    @Inject(MimicSymbolLibrariesService) symbolLibraries: MimicSymbolLibrariesService,
    @Inject(VocabulariesService) vocabularies: VocabulariesService,
    // `F4.274`: appended last — the wiring spec reads the slots by index.
    @Inject(TelemetryService) telemetry: TelemetryService,
    // `F4.275`: appended last, the same reason. `DashboardService` is the KPI
    // service (`dashboard/`), not the builder's `DashboardsService` above.
    @Inject(DashboardService) portfolio: DashboardService,
    @Inject(ReportsService) reports: ReportsService,
    // `F4.277`: appended last, the same reason.
    @Inject(AuditAdminService) audit: AuditAdminService,
    @Inject(SystemStatusService) systemStatus: SystemStatusService,
    // `F4.276`: appended last, the same reason.
    @Inject(AlarmDetailsService) alarmDetails: AlarmDetailsService,
    @Inject(AlarmKbService) alarmKb: AlarmKbService,
    // `F4.278`: appended last (slot 17), the same reason.
    @Inject(RulesService) rules: RulesService,
    // `F4.279`: appended last (slots 18 and 19), the same reason.
    @Inject(ChannelsService) channels: ChannelsService,
    @Inject(EscalationProfilesService) escalationProfiles: EscalationProfilesService,
    // `F4.280`: appended last (slot 20), the same reason.
    @Inject(ReportSchedulesService) schedules: ReportSchedulesService,
    // `F4.281`: appended last (slot 21), the same reason.
    @Inject(MaintenanceService) maintenance: MaintenanceService,
    // `F4.284`: appended last (slots 22 and 23), the same reason.
    @Inject(WorkOrdersService) workOrders: WorkOrdersService,
    @Inject(UsersService) users: UsersService,
    // `F4.291`: appended last (slot 24), the same reason. The location helper is
    // `AuthModule`'s (`@Global()`), so `CopilotModule` imports nothing for it.
    @Inject(LocationAssetScopeService) locationScope: LocationAssetScopeService,
  ) {
    this.tools = createCopilotReadTools({
      access,
      alarms,
      assets,
      kpis,
      locations,
      dashboards,
      health,
      layouts,
      symbolLibraries,
      vocabularies,
      telemetry,
      portfolio,
      reports,
      audit,
      systemStatus,
      alarmDetails,
      alarmKb,
      rules,
      channels,
      escalationProfiles,
      schedules,
      maintenance,
      workOrders,
      users,
      locationScope,
    });
  }

  get registry(): ToolRegistry<string> {
    return this.tools.registry;
  }

  dispatch(name: string, args: Record<string, unknown>, ctx: CopilotToolContext): Promise<CopilotToolResult> {
    return this.tools.dispatch(name, args, ctx);
  }
}
