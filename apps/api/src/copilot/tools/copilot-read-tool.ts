import type { z, ZodTypeAny } from "zod";

import type { AuditAdminService } from "../../admin/audit/audit.service";
import type { LocationsAdminService } from "../../admin/locations/locations.service";
import type { AlarmsService } from "../../alarms/alarms.service";
import type { AssetHealthService } from "../../asset-health/asset-health.service";
import type { AssetKpisService } from "../../assets/asset-kpis.service";
import type { AssetsService } from "../../assets/assets.service";
import type { AccessControlService } from "../../auth/access-control.service";
import type { DashboardService } from "../../dashboard/dashboard.service";
import type { DashboardsService } from "../../dashboard-builder/dashboards.service";
import type { MimicLayoutsService } from "../../mimic-layouts/mimic-layouts.service";
import type { MimicSymbolLibrariesService } from "../../mimic-symbol-libraries/mimic-symbol-libraries.service";
import type { ReportsService } from "../../reports/reports.service";
import type { SystemStatusService } from "../../system-status/system-status.service";
import type { TelemetryService } from "../../telemetry/telemetry.service";
import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

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
  /**
   * `F4.275`: the energy and portfolio reads behind `/`, `/energy` and
   * `/sustainability`. `DashboardService` (the KPI service, `dashboard/`) is
   * not `DashboardsService` (the dashboard builder, the `dashboards` key), so
   * this key is `portfolio`. Every method reads the whole fleet for
   * `assetIds: null`; the tools call it per organization through
   * `readPerOrganization`, never with `null`.
   */
  readonly portfolio: Pick<DashboardService, "kpis" | "loadTrend" | "energySummary" | "energySourceMix" | "energyTopConsumers">;
  /** `F4.275`: the energy report preview (`GET /reports/energy/preview`); the same `null` rule. */
  readonly reports: Pick<ReportsService, "energyPreview">;
  /** `F4.277`: the audit list (`GET /admin/audit`); `list` only, so the export is unreachable. */
  readonly audit: Pick<AuditAdminService, "list">;
  /** `F4.277`: the system status (`GET /system/status`); never called with `null` (the whole fleet). */
  readonly systemStatus: Pick<SystemStatusService, "read">;
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
  const organizations: Array<{ organizationId: string; items: T[] } & Record<string, unknown>> = [];
  const read: string[] = [];
  return {
    organizations,
    read,
    /** `F4.275`: `extra` (a series' stats, a report's totals) is spread into the organization's entry. */
    add(organizationId: string, items: readonly T[], room: number, extra?: Record<string, unknown>): number {
      read.push(organizationId);
      const kept = items.slice(0, Math.max(0, room));
      organizations.push({ ...extra, organizationId, items: kept });
      return kept.length;
    },
  };
}

/**
 * One organization's answer to {@link readPerOrganization}: its items, entry
 * extras, and whether more were left out. `entryCost` is the room the entry's
 * `extra` takes, counted in items, for a tool whose per-organization extra is
 * large enough that the item cap alone would not bound the result.
 */
export type OrganizationRead<T> = {
  readonly items: readonly T[];
  readonly extra?: Record<string, unknown>;
  readonly more?: boolean;
  readonly entryCost?: number;
};

/**
 * `F4.275` — the `list_alarms` loop as one helper: the organizations the turn
 * may read (`targetOrganizations`), one `readableAssetIdsInOrganization` each,
 * and `read` only for an organization with at least one readable asset, so a
 * service is never called with `null` (the whole fleet) or `[]`. The items are
 * cut at `COPILOT_TOOL_LIST_MAX_ITEMS` across organizations; `room` tells
 * `read` how many still fit, and an organization past a full room is not read.
 */
export async function readPerOrganization<T>(
  access: CopilotReadServices["access"],
  ctx: CopilotToolContext,
  requestedOrganizationId: string | undefined,
  read: (organizationId: string, assetIds: readonly string[], room: number) => Promise<OrganizationRead<T>>,
): Promise<CopilotToolResult> {
  const target = targetOrganizations(requestedOrganizationId, ctx.allowedOrganizationIds);
  if (!target.ok) return target;
  const out = collectByOrganization<T>();
  let room = COPILOT_TOOL_LIST_MAX_ITEMS;
  let truncated = false;
  for (const organizationId of target.ids) {
    if (room <= 0) {
      truncated = true;
      break;
    }
    const assetIds = await access.readableAssetIdsInOrganization(ctx.user, organizationId);
    if (assetIds.length === 0) {
      out.add(organizationId, [], room);
      continue;
    }
    const answer = await read(organizationId, assetIds, room);
    const cost = answer.entryCost ?? 0;
    const kept = out.add(organizationId, answer.items, room - cost, answer.extra);
    room -= kept + cost;
    // A slice by the room drops rows as surely as `more` does.
    if (answer.more === true || kept < answer.items.length) truncated = true;
  }
  return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
}
