import type { z, ZodType, ZodTypeAny, ZodTypeDef } from "zod";

import type { AuditAdminService } from "../../admin/audit/audit.service";
import type { LocationsAdminService } from "../../admin/locations/locations.service";
import type { AlarmKbService } from "../../alarm-kb/alarm-kb.service";
import type { AlarmDetailsService } from "../../alarms/alarm-details.service";
import type { AlarmStatsService } from "../../alarms/alarm-stats.service";
import type { AlarmsService } from "../../alarms/alarms.service";
import type { AssetHealthService } from "../../asset-health/asset-health.service";
import type { AssetKpisService } from "../../assets/asset-kpis.service";
import type { AssetsService } from "../../assets/assets.service";
import type { AccessControlService } from "../../auth/access-control.service";
import type { LocationAssetScopeService } from "../../auth/location-asset-scope.service";
import type { DashboardService } from "../../dashboard/dashboard.service";
import type { DashboardsService } from "../../dashboard-builder/dashboards.service";
import type { MaintenanceService } from "../../maintenance/maintenance.service";
import type { UsersService } from "../../admin/users/users.service";
import type { WorkOrdersService } from "../../work-orders/work-orders.service";
import type { MimicLayoutsService } from "../../mimic-layouts/mimic-layouts.service";
import type { MimicSymbolLibrariesService } from "../../mimic-symbol-libraries/mimic-symbol-libraries.service";
import type { ChannelsService } from "../../notifications/channels.service";
import type { EscalationProfilesService } from "../../notifications/escalation-profiles.service";
import type { ReportSchedulesService } from "../../reports/report-schedules.service";
import type { ReportsService } from "../../reports/reports.service";
import type { RulesService } from "../../rules/rules.service";
import type { SystemStatusService } from "../../system-status/system-status.service";
import type { TelemetryService } from "../../telemetry/telemetry.service";
import type { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { COPILOT_TOOL_BAD_CURSOR, decodeListCursor, encodeListCursor, type ListCursor } from "./copilot-list-paging";
import { COPILOT_TOOL_LIST_MAX_ITEMS, locationRefusal, targetOrganizations } from "./copilot-tool-scope";

/**
 * `F3.85` PR 7 — the services the read tools call, narrowed to the one method
 * each uses, so a spec passes a fake with a call counter and nothing else.
 */
export interface CopilotReadServices {
  /** `F4.276`: `readableOrganizationIds` narrows `get_alarm_kb`'s BYPASSRLS read, as `GET /alarm-kb` does. */
  readonly access: Pick<AccessControlService, "readableAssetIdsInOrganization" | "readableOrganizationIds">;
  /**
   * `F4.291` (owner ruling P5): a `locationId` to the caller's readable asset ids of its
   * subtree, through the one shared helper in `auth/`; `readPerOrganization` calls it.
   */
  readonly locationScope: Pick<LocationAssetScopeService, "readableAssetIdsInLocations">;
  readonly alarms: Pick<AlarmsService, "list">;
  /**
   * `F4.291` PR 2: `get_alarm_stats`' counts, MTTA and MTTR, once per organization
   * through `readPerOrganization`; never called with `null` or `[]`.
   */
  readonly alarmStats: Pick<AlarmStatsService, "range">;
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
   * `F4.291` PR 3: `pointStatsByAsset` for `get_point_stats`, never with `[]`.
   */
  readonly telemetry: Pick<TelemetryService, "latestPointValues" | "pointValuesAt" | "recentForPoint" | "pointAggregate" | "pointStatsByAsset">;
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
  /**
   * `F4.276`: one alarm's details (`GET /alarms/:id/details`); never called with
   * `null`. `get` only, so the acknowledgement and the enrichment stay unreachable.
   */
  readonly alarmDetails: Pick<AlarmDetailsService, "get">;
  /**
   * `F4.276`: the alarm knowledge base (`GET /alarm-kb`); never called with
   * `null` (the unrestricted-admin scope) or `[]`.
   */
  readonly alarmKb: Pick<AlarmKbService, "list">;
  /**
   * `F4.278` (Amendment 8 D7): the Rule Engine's rule list (`GET /rules`); never
   * called with `null` (the whole fleet) or `[]`.
   */
  readonly rules: Pick<RulesService, "listRules">;
  /**
   * `F4.279` (Amendment 8 D7): the Channels page's list (`GET /notifications/channels`);
   * `list` only, so no write and no secret read is reachable.
   */
  readonly channels: Pick<ChannelsService, "list">;
  /** `F4.279` (D7, Q9): the Escalation page's profile list and severity map; reads only. */
  readonly escalationProfiles: Pick<EscalationProfilesService, "list" | "getDefaults">;
  /** `F4.280` (Amendment 8 D7, Q1): the Reports page's schedule list (`GET /reports/schedules`); `list` only. */
  readonly schedules: Pick<ReportSchedulesService, "list">;
  /**
   * `F4.281` (Amendment 8 D7, owner ruling DC4): the Schedule Centre's list
   * (`GET /maintenance/schedules`); `list` only, never called with `null` or `[]`.
   */
  readonly maintenance: Pick<MaintenanceService, "list">;
  /** `F4.284` (owner ruling DC7): the work-orders board's list; `list` only, never called with `null` or `[]`. */
  readonly workOrders: Pick<WorkOrdersService, "list">;
  /** `F4.284` (owner ruling DC1): the Users page's list, behind its own manager gate; `list` only. */
  readonly users: Pick<UsersService, "list">;
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
 * large enough that the item cap alone would not bound the result. `nextKey`
 * (`F4.291`, paged tools only) is the key to resume THIS organization at; a
 * paged answer that is cut must carry it. `capped` (`F4.291`) says the
 * service itself stopped at its row cap, so rows past the last page exist
 * that no cursor reaches: the result stays `truncated` with no `nextKey`.
 * `keyAt` (`F4.291` live check, paged tools only) is the key to resume THIS
 * organization at after its first `kept` items (`undefined`: its first
 * row), so {@link fitListResult} can drop trailing items from a page that is
 * too long for the model and still resume after the last item it kept.
 */
export type OrganizationRead<T, K = never> = {
  readonly items: readonly T[];
  readonly extra?: Record<string, unknown>;
  readonly more?: boolean;
  readonly entryCost?: number;
  readonly nextKey?: K;
  readonly capped?: boolean;
  readonly keyAt?: (kept: number) => K | undefined;
};

/**
 * `F4.291` live check — the characters a list result's JSON may take.
 * `toolResultContent` cuts every tool result at `TOOL_RESULT_MAX_CHARS`
 * with a fixed tail, and a cut list is broken JSON with its paging keys gone
 * (a 25-alarm page measured 11,880). The JSON is measured after the secret
 * scrub the turn service applies (`succeed(scrubToolResult(result))`), whose
 * replacement may be longer than the value it hides, row after row. The 500
 * left cover the `succeed` wrapper (`{"ok":true,…}`, 11) with room to spare.
 */
export const COPILOT_TOOL_RESULT_BUDGET_CHARS = TOOL_RESULT_MAX_CHARS - 500;

type ListEntry = { organizationId: string; items: unknown[] } & Record<string, unknown>;

/**
 * `F4.291` live check — a list result whose page is whole. `truncated`
 * and `nextCursor` come first, so a backstop cut never removes them. While
 * the JSON the model receives (after `scrubToolResult`, which is idempotent:
 * its replacement does not match itself) is longer than
 * {@link COPILOT_TOOL_RESULT_BUDGET_CHARS}, the last
 * item is dropped (an emptied organization after the first is dropped
 * entirely); the result is then `truncated`, and with `paging` the cursor
 * names the last organization at `keyAt` of the items it kept — so the next
 * page starts at the first item this one dropped, and no row is skipped. A
 * paged organization that lost items without a `keyAt` is a defect (throws).
 * A result within the budget is returned as it was built. `entries` and
 * `read` are the `collectByOrganization` arrays and are trimmed in place.
 */
export function fitListResult<K>(
  entries: ListEntry[],
  read: string[],
  state: { truncated: boolean; next: ListCursor<K> | null },
  paging: { readonly keyAt: ReadonlyMap<string, (kept: number) => K | undefined> } | undefined,
): CopilotToolResult {
  let { truncated, next } = state;
  const assemble = (): Record<string, unknown> => {
    const result: Record<string, unknown> = { truncated };
    if (paging !== undefined) result.nextCursor = next === null ? null : encodeListCursor(next as ListCursor<string | number>);
    result.organizations = entries;
    return result;
  };
  let result = assemble();
  while (JSON.stringify(scrubToolResult(result)).length > COPILOT_TOOL_RESULT_BUDGET_CHARS) {
    const last = entries[entries.length - 1];
    if (last === undefined) break;
    if (last.items.length > 0) {
      last.items.pop();
      if (paging !== undefined) {
        const keyAt = paging.keyAt.get(last.organizationId);
        if (keyAt === undefined) throw new Error(`F4.291: a paged read of ${last.organizationId} cannot resume after a fitted page`);
        const k = keyAt(last.items.length);
        next = k === undefined ? { o: last.organizationId } : { o: last.organizationId, k };
      }
    } else if (entries.length > 1) {
      // Never the first entry, so the cursor's own organization is never left behind its resume key.
      entries.pop();
      read.pop();
      if (paging !== undefined) next = { o: last.organizationId };
    } else {
      break;
    }
    truncated = true;
    result = assemble();
  }
  return { ok: true, result, organizationIds: read };
}

/** `F4.291` live check: an unpaged list's result, `truncated` first and fitted to the budget. */
export function listResult(out: { organizations: ListEntry[]; read: string[] }, truncated: boolean): CopilotToolResult {
  return fitListResult<never>(out.organizations, out.read, { truncated, next: null }, undefined);
}

/**
 * `F4.291` — a tool's opt-in paging: the call's `cursor` argument and the
 * schema its resume key must match. A tool that passes none returns no
 * `nextCursor` (its schema has no `cursor` to send one back in).
 */
export type ListPaging<K> = { readonly cursor: string | undefined; readonly key: ZodType<K, ZodTypeDef, unknown> };

/** `F4.291` — what one list call reads: an organization, a location (a site and its subtree), and paging. */
export type ListScope<K> = {
  readonly organizationId?: string;
  readonly locationId?: string;
  readonly paging?: ListPaging<K>;
};

/**
 * `F4.275` — the `list_alarms` loop as one helper: the organizations the turn
 * may read (`targetOrganizations`), one `readableAssetIdsInOrganization` each,
 * and `read` only for an organization with at least one readable asset, so a
 * service is never called with `null` (the whole fleet) or `[]`. The items are
 * cut at `COPILOT_TOOL_LIST_MAX_ITEMS` across organizations; `room` tells
 * `read` how many still fit, and an organization past a full room is not read.
 *
 * `F4.291` (ADR 0099 Amendment 9 E5): with `scope.locationId` the location is
 * placed among the target organizations by `LocationAssetScopeService`
 * (refused when it is not found there or lies outside the caller's grant),
 * and only its organization is read, with the subtree's readable asset ids in
 * place of the organization's. A named `organizationId` other than the
 * location's makes the location not found (the candidates are that one
 * organization). With `scope.paging` the result carries `nextCursor` (see
 * {@link pageOrganizations}).
 */
export async function readPerOrganization<T, K = never>(
  services: Pick<CopilotReadServices, "access" | "locationScope">,
  ctx: CopilotToolContext,
  scope: ListScope<K>,
  read: (organizationId: string, assetIds: readonly string[], room: number, resume: K | undefined) => Promise<OrganizationRead<T, K>>,
): Promise<CopilotToolResult> {
  const target = targetOrganizations(scope.organizationId, ctx.allowedOrganizationIds);
  if (!target.ok) return target;
  let organizations = target.ids;
  let located: readonly string[] | undefined;
  if (scope.locationId !== undefined) {
    const place = await services.locationScope.readableAssetIdsInLocations(ctx.user, target.ids, [scope.locationId]);
    if (!place.ok) return { ok: false, error: locationRefusal(place.reason) };
    organizations = [place.organizationId];
    located = place.assetIds;
  }
  return pageOrganizations<T, K>(organizations, scope.paging, async (organizationId, room, resume) => {
    const assetIds = located ?? (await services.access.readableAssetIdsInOrganization(ctx.user, organizationId));
    return assetIds.length === 0 ? null : read(organizationId, assetIds, room, resume);
  });
}

/**
 * `F4.291` — the organization loop under {@link readPerOrganization}, also
 * used by a list that reads no asset ids (`list_locations`). `readOne`
 * answers `null` for an organization listed empty and unread, or a refusal
 * that fails the whole call.
 *
 * With `paging`, a cursor resumes at its organization and key, and the loop
 * stops at the first organization whose answer is cut, so every later
 * organization is reached by the cursor and never by the same call twice.
 * `nextCursor` is that organization and its `nextKey`, the next organization
 * when the room ran out between two, or `null` when nothing is left that a
 * cursor reaches (an answer `capped` by its service is `truncated` with a
 * `null` cursor, so a last page is never shown as the whole list). Without
 * `paging` the result has no `nextCursor` key at all. The result is then
 * fitted to the model's budget ({@link fitListResult}).
 */
export async function pageOrganizations<T, K>(
  organizations: readonly string[],
  paging: ListPaging<K> | undefined,
  readOne: (organizationId: string, room: number, resume: K | undefined) => Promise<OrganizationRead<T, K> | null | { readonly refusal: string }>,
): Promise<CopilotToolResult> {
  let first = 0;
  let resume: K | undefined;
  if (paging?.cursor !== undefined) {
    const cursor = decodeListCursor(paging.cursor, paging.key, organizations);
    if (cursor === null) return { ok: false, error: COPILOT_TOOL_BAD_CURSOR };
    first = organizations.indexOf(cursor.o);
    resume = cursor.k;
  }
  const out = collectByOrganization<T>();
  let room = COPILOT_TOOL_LIST_MAX_ITEMS;
  let truncated = false;
  let next: ListCursor<K> | null = null;
  const keyAt = new Map<string, (kept: number) => K | undefined>();
  for (let i = first; i < organizations.length; i += 1) {
    const organizationId = organizations[i]!;
    if (room <= 0) {
      truncated = true;
      next = { o: organizationId };
      break;
    }
    const answer = await readOne(organizationId, room, i === first ? resume : undefined);
    if (answer === null) {
      out.add(organizationId, [], room);
      continue;
    }
    if ("refusal" in answer) return { ok: false, error: answer.refusal };
    const cost = answer.entryCost ?? 0;
    const kept = out.add(organizationId, answer.items, room - cost, answer.extra);
    if (answer.keyAt !== undefined) keyAt.set(organizationId, answer.keyAt);
    room -= kept + cost;
    // A slice by the room drops rows as surely as `more` does.
    if (answer.more !== true && kept >= answer.items.length) {
      // The service's own cap: rows are left that no cursor reaches.
      if (answer.capped === true) truncated = true;
      continue;
    }
    truncated = true;
    if (paging === undefined) continue;
    if (answer.nextKey === undefined || kept < answer.items.length) {
      throw new Error(`F4.291: a paged read cut ${organizationId} without the key to resume it at`);
    }
    next = { o: organizationId, k: answer.nextKey };
    break;
  }
  return fitListResult(out.organizations, out.read, { truncated, next }, paging === undefined ? undefined : { keyAt });
}
