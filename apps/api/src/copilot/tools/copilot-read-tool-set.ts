import { Inject, Injectable } from "@nestjs/common";
import type { ZodTypeAny } from "zod";

import { LocationsAdminService } from "../../admin/locations/locations.service";
import { AlarmsService } from "../../alarms/alarms.service";
import { AssetHealthService } from "../../asset-health/asset-health.service";
import { AssetKpisService } from "../../assets/asset-kpis.service";
import { AssetsService } from "../../assets/assets.service";
import { AccessControlService } from "../../auth/access-control.service";
import { DashboardsService } from "../../dashboard-builder/dashboards.service";
import { defineToolRegistry, type ToolRegistry } from "../../llm/tool-registry";
import type { CopilotReadTools, CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices, CopilotReadToolDefinition } from "./copilot-read-tool";
import { getAssetKpisTool } from "./get-asset-kpis.tool";
import { getHealthSummaryTool } from "./get-health-summary.tool";
import { listAlarmsTool } from "./list-alarms.tool";
import { listAssetsTool } from "./list-assets.tool";
import { listDashboardsTool } from "./list-dashboards.tool";
import { listLocationsTool } from "./list-locations.tool";
import { openPageTool } from "./open-page.tool";

/** Release 1's read tools, in the order the model sees them. No tool here writes. */
export const COPILOT_READ_TOOL_DEFINITIONS: readonly CopilotReadToolDefinition[] = [
  listAlarmsTool,
  listAssetsTool,
  getAssetKpisTool,
  listLocationsTool,
  listDashboardsTool,
  getHealthSummaryTool,
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
  ) {
    this.tools = createCopilotReadTools({ access, alarms, assets, kpis, locations, dashboards, health });
  }

  get registry(): ToolRegistry<string> {
    return this.tools.registry;
  }

  dispatch(name: string, args: Record<string, unknown>, ctx: CopilotToolContext): Promise<CopilotToolResult> {
    return this.tools.dispatch(name, args, ctx);
  }
}
