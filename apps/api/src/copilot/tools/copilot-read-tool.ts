import type { z, ZodTypeAny } from "zod";

import type { LocationsAdminService } from "../../admin/locations/locations.service";
import type { AlarmsService } from "../../alarms/alarms.service";
import type { AssetHealthService } from "../../asset-health/asset-health.service";
import type { AssetKpisService } from "../../assets/asset-kpis.service";
import type { AssetsService } from "../../assets/assets.service";
import type { AccessControlService } from "../../auth/access-control.service";
import type { DashboardsService } from "../../dashboard-builder/dashboards.service";
import type { MimicLayoutsService } from "../../mimic-layouts/mimic-layouts.service";
import type { MimicSymbolLibrariesService } from "../../mimic-symbol-libraries/mimic-symbol-libraries.service";
import type { TelemetryService } from "../../telemetry/telemetry.service";
import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";

/**
 * `F3.85` PR 7 — the services the read tools call, narrowed to the one method
 * each uses, so a spec passes a fake with a call counter and nothing else.
 */
export interface CopilotReadServices {
  readonly access: Pick<AccessControlService, "readableAssetIdsInOrganization">;
  readonly alarms: Pick<AlarmsService, "list">;
  /** `F4.274`: `listPoints` for `list_asset_points`. */
  readonly assets: Pick<AssetsService, "listAll" | "listPoints">;
  readonly kpis: Pick<AssetKpisService, "listKpis">;
  readonly locations: Pick<LocationsAdminService, "list">;
  readonly dashboards: Pick<DashboardsService, "list">;
  readonly health: Pick<AssetHealthService, "summary">;
  /** `F3.87` PR 2 (ADR 0099 Amendment 3 drafter choice 1): the mimic reads and the unit-role vocabulary. */
  readonly layouts: Pick<MimicLayoutsService, "list" | "get">;
  readonly symbolLibraries: Pick<MimicSymbolLibrariesService, "list">;
  readonly vocabularies: Pick<VocabulariesService, "list">;
  /**
   * `F4.274`: the telemetry reads. `telemetry.*` carries no Row Level Security
   * and the service reads on the tenant pool unfiltered, so each tool places
   * its asset (`organizationOfAsset` / `organizationsOfAssets`) first.
   */
  readonly telemetry: Pick<TelemetryService, "latestPointValues" | "pointValuesAt" | "recentForPoint" | "pointAggregate">;
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
