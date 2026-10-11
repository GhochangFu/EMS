import type { z, ZodTypeAny } from "zod";

import type { LocationsAdminService } from "../../admin/locations/locations.service";
import type { AlarmsService } from "../../alarms/alarms.service";
import type { AssetHealthService } from "../../asset-health/asset-health.service";
import type { AssetKpisService } from "../../assets/asset-kpis.service";
import type { AssetsService } from "../../assets/assets.service";
import type { AccessControlService } from "../../auth/access-control.service";
import type { DashboardsService } from "../../dashboard-builder/dashboards.service";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";

/**
 * `F3.85` PR 7 — the services the read tools call, narrowed to the one method
 * each uses, so a spec passes a fake with a call counter and nothing else.
 */
export interface CopilotReadServices {
  readonly access: Pick<AccessControlService, "readableAssetIdsInOrganization">;
  readonly alarms: Pick<AlarmsService, "list">;
  readonly assets: Pick<AssetsService, "listAll">;
  readonly kpis: Pick<AssetKpisService, "listKpis">;
  readonly locations: Pick<LocationsAdminService, "list">;
  readonly dashboards: Pick<DashboardsService, "list">;
  readonly health: Pick<AssetHealthService, "summary">;
}

/** One read tool: its argument schema (strict), the model's description, and the call. */
export interface CopilotReadToolDefinition<Schema extends ZodTypeAny = ZodTypeAny> {
  readonly name: string;
  readonly schema: Schema;
  readonly description: string;
  run(services: CopilotReadServices, args: z.infer<Schema>, ctx: CopilotToolContext): Promise<CopilotToolResult>;
}

/** Types one read tool definition against its argument schema. */
export function defineReadTool<Schema extends ZodTypeAny>(tool: CopilotReadToolDefinition<Schema>): CopilotReadToolDefinition<Schema> {
  return tool;
}

/** A list result over several organizations, cut at `max` items in total. */
export function collectByOrganization<T>() {
  const organizations: Array<{ organizationId: string; items: T[] }> = [];
  const read: string[] = [];
  return {
    organizations,
    read,
    add(organizationId: string, items: readonly T[], room: number): number {
      read.push(organizationId);
      const kept = items.slice(0, Math.max(0, room));
      organizations.push({ organizationId, items: kept });
      return kept.length;
    },
  };
}
