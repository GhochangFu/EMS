import { expect } from "vitest";

import type { EscalationProfileDto, JwtPayload, MaintenanceScheduleItem, ReportScheduleDto, WorkOrderListItem } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { succeed, TOOL_RESULT_CUT_TAIL, TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import { mapRuleRow } from "../../rules/rule-mapping";
import { ruleRow } from "../../rules/rule-mapping.spec";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { scrubToolResult } from "../copilot-secret-scrub";
import { COPILOT_TOOL_RESULT_BUDGET_CHARS, type CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { alarmKeyset } from "./list-alarms.tool";

/**
 * `F4.291` live check — a capped copilot list reaches the model whole.
 *
 * `toolResultContent` cuts a tool result at `TOOL_RESULT_MAX_CHARS` (8,000)
 * with a fixed tail. Live, a 25-alarm `list_alarms` page was 11,880
 * characters: the cut left broken JSON with ~17 of 25 rows and took
 * `truncated` and `nextCursor` (serialized last) with it, and the model
 * re-called the tool until the turn's caps stopped it. The fix: `truncated`
 * and `nextCursor` are serialized before the rows, and `fitListResult`
 * drops trailing rows to `COPILOT_TOOL_RESULT_BUDGET_CHARS`, resuming after
 * the last row it kept.
 *
 * Measured 25-row page sizes (the seeded DB on 2026-10-28, the 25 longest
 * rows in each tool's own fields, `json_build_object` less ~3 characters a
 * field for its spacing). Every list whose page can pass the budget has a
 * claim here:
 * - `list_alarms` ~11,800 (probe: 11,880 and 11,722; ~470 a row)
 * - `list_assets` ~9,750 (~390 a row) · `list_rules` ~11,200 (~450, the
 *   `condition` JSON) · `list_locations` ~14,000 (~560, the `meta` JSON)
 * - `list_work_orders` ~10,000 and `list_maintenance_schedules` ~10,500
 *   (two and three seeded rows; sized from realistic titles and names)
 * - `list_dashboards` ~11,000 (a seeded row is up to 550 as stored) ·
 *   `list_report_schedules` ~8,250 · `list_escalation_profiles` over 8,000
 *   with three steps of two channels (no seeded rows; sized from the DTO)
 * - under the budget at 25 rows, so no claim: `list_users` ~2,500,
 *   `list_notification_channels` ~5,750, `list_mimic_layouts` ~5,000,
 *   `list_asset_points` ~1,000, `get_recent_values` ~1,500.
 *   `list_audit_log`, `list_mimic_symbols` and `get_alarm_kb` bound their
 *   own characters (6,000, 6,500 and their own budget).
 *
 * Every fixture below takes its field lengths from the live rows (ids, codes,
 * names, rule keys, ISO timestamps). One `it()` per claim in the sibling
 * `.test.ts` (ADR 0014).
 */

const USER = "8d4290b4-9ecf-4a65-a82c-e6c66e31c24f";
const ORG = "ed2aebf8-becc-4888-bd69-a1e96bb36c42";
const NOW = new Date("2026-10-28T06:00:00Z");

/** A uuid whose last twelve digits are `i` (distinct and in id order). */
const uuid = (prefix: string, i: number) => `${prefix}-4b4b-4c4c-8d8d-${String(i).padStart(12, "0")}`;
const ASSETS = Array.from({ length: 24 }, (_, i) => uuid("8c733274", i));

function ctx(): CopilotToolContext {
  return {
    identity: { id: USER, role: "admin", organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role: "admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: [ORG],
    turnKind: "user",
    now: NOW,
  };
}

/** A live-length alarm: the probe's `KZN-CR-UTILITY` row, numbered. Newest first by `raisedAt`, ties broken by id. */
function alarm(i: number) {
  return {
    id: uuid("5b6fcebe", i),
    assetId: ASSETS[i % ASSETS.length]!,
    ruleKey: `ESKOM_KZN_CR_UTILITY_${String(i).padStart(2, "0")}_BREAKER_OPEN`,
    ruleId: uuid("c72de634", i),
    severity: "critical",
    message: `Main breaker reported OPEN (feeder ${i})`,
    // Each pair shares a raisedAt, so a resume on the timestamp alone would skip a row.
    raisedAt: new Date(Date.parse("2026-10-23T11:52:09.299Z") - Math.floor(i / 2) * 61_000).toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: "2026-10-23T11:54:38.820Z",
    assetCode: "KZN-CR-UTILITY",
    assetName: "KwaZulu-Natal Control Room Utility Incomer",
    siteName: "RSMOC KwaZulu-Natal",
  };
}

type AlarmRow = ReturnType<typeof alarm>;

/** `AlarmsService.list`'s keyset as SQL runs it: `(raised_at, id) < (t, id)` in `raised_at DESC, id DESC` order. */
function keysetPage(rows: readonly AlarmRow[], limit: number, cursor: string | undefined) {
  const sorted = [...rows].sort((a, b) => (a.raisedAt === b.raisedAt ? (a.id < b.id ? 1 : -1) : a.raisedAt < b.raisedAt ? 1 : -1));
  const c = cursor === undefined ? null : (JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as { t: string; id: string });
  const after = c === null ? sorted : sorted.filter((row) => row.raisedAt < c.t || (row.raisedAt === c.t && row.id < c.id));
  const page = after.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: after.length > limit && last ? alarmKeyset(last) : null };
}

function asset(i: number) {
  return {
    id: uuid("02d73c45", i),
    code: `KZN-CR-UTILITY-${String(i).padStart(2, "0")}`,
    name: `KwaZulu-Natal Control Room Utility Incomer ${i}`,
    siteName: "RSMOC KwaZulu-Natal",
    domain: "electrical",
    locationId: uuid("e0bb42bb", 1),
    locationName: "RSMOC KwaZulu-Natal Control Room",
    rtuId: uuid("9f1cbb07", i),
    rtuDisplayName: "KZN Control Room RTU 1",
    telemetrySource: "mqtt",
    active: true,
    templateId: uuid("fb1ffbd4", 1),
  };
}

function location(i: number) {
  const n = String(i).padStart(2, "0");
  return {
    id: uuid("e0bb42bb", i),
    organizationId: ORG,
    organizationCode: "ESKOM",
    organizationName: "Eskom SMOC",
    code: `RSMOC-KZN-${n}`,
    slug: `rsmoc-kwazulu-natal-${n}`,
    name: `RSMOC KwaZulu-Natal ${n}`,
    type: "rsmoc",
    typeLabel: "RSMOC",
    parentId: null,
    province: "KwaZulu-Natal",
    capital: "Pietermaritzburg",
    timezone: "Africa/Johannesburg",
    latitude: -29.6006,
    longitude: 30.3794,
    active: true,
    meta: { type: "RSMOC", source: "attached-location-dataset", capital: "Pietermaritzburg", seedKey: `rsmoc-kwazulu-natal-${n}` },
    createdAt: "2026-10-14T16:44:39.671Z",
    updatedAt: "2026-10-28T12:47:53.502Z",
  };
}

function rule(i: number) {
  const n = String(i).padStart(2, "0");
  return mapRuleRow(
    ruleRow({
      id: uuid("c72de634", i),
      code: `ESKOM_KZN_CR_BATT_${n}_VOLTAGE_CRITICAL`,
      name: `KwaZulu-Natal Control Room Battery String ${n} L1 voltage critical`,
      organizationId: ORG,
      assetOrganizationId: ORG,
      assetId: ASSETS[i % ASSETS.length]!,
      assetCode: `KZN-CR-BATT-${n}`,
      pointKey: "voltage_l1_v",
      operator: "gte",
      thresholdValue: 239.5,
      severity: "critical",
      condition: { unit: "V", window: "latest", alarmMessage: "voltage_l1_critical" },
    }),
  );
}

function workOrder(i: number): WorkOrderListItem {
  return {
    id: uuid("60000000", i),
    assetId: ASSETS[i % ASSETS.length]!,
    alarmId: uuid("5b6fcebe", i),
    title: `Inspect the main breaker of the KZN control room utility incomer ${i}`,
    description: null,
    status: "open",
    priority: "high",
    sortOrder: i,
    assignedTo: USER,
    createdBy: USER,
    dueAt: "2026-10-30T09:00:00.000Z",
    resolvedAt: null,
    closedAt: null,
    createdAt: "2026-10-20T06:00:00.000Z",
    updatedAt: "2026-10-20T06:00:00.000Z",
    assetCode: "KZN-CR-UTILITY",
    assetName: "KwaZulu-Natal Control Room Utility Incomer",
    siteName: "RSMOC KwaZulu-Natal",
  };
}

function schedule(i: number): MaintenanceScheduleItem {
  return {
    id: uuid("40000000", i),
    templateId: uuid("50000000", i),
    assetId: ASSETS[i % ASSETS.length]!,
    title: `Quarterly thermographic scan of the utility incomer switchgear ${i}`,
    description: "Scan every busbar joint under load",
    category: "preventive",
    generationMode: "calendar",
    ownerTeam: "Electrical maintenance",
    vendorName: null,
    complianceRef: null,
    triggerSummary: "Every 90 days",
    safetyCritical: true,
    priority: "high",
    estimatedMinutes: 120,
    intervalDays: 90,
    nextDueAt: new Date(Date.parse("2026-11-01T09:00:00.000Z") + i * 86_400_000).toISOString(),
    lastCompletedAt: "2026-08-01T09:00:00.000Z",
    dueState: "upcoming",
    assetCode: "KZN-CR-UTILITY",
    assetName: "KwaZulu-Natal Control Room Utility Incomer",
    siteName: "RSMOC KwaZulu-Natal",
    activeWorkOrderId: null,
    active: true,
  };
}

function dashboard(i: number) {
  return {
    id: uuid("60000000", i),
    organizationId: ORG,
    slug: `rsmoc-kwazulu-natal-control-room-energy-${i}`,
    name: `RSMOC KwaZulu-Natal Control Room energy overview ${i}`,
    description: "Incomer, UPS strings and HVAC load for the control room",
    locationId: uuid("e0bb42bb", 1),
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    createdAt: "2026-10-14T16:44:39.671Z",
    updatedAt: "2026-10-28T12:47:53.502Z",
    widgetCount: 12,
  };
}

function reportSchedule(i: number): ReportScheduleDto {
  return {
    id: uuid("44444444", i),
    organizationId: ORG,
    name: `Weekly energy consumption, RSMOC KwaZulu-Natal ${i}`,
    templateId: "energy_consumption",
    formats: ["pdf", "xlsx"],
    cadence: "weekly",
    runAtLocal: "07:00",
    timezone: "Africa/Johannesburg",
    locationIds: [uuid("e0bb42bb", 1)],
    channelId: uuid("77777777", 1),
    enabled: true,
    nextRunAt: "2026-11-02T05:00:00.000Z",
    lastRunAt: null,
    createdBy: USER,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function profile(i: number): EscalationProfileDto {
  const step = (stepNo: number) => ({ stepNo, afterMinutes: stepNo * 15, channelIds: [uuid("77777777", stepNo), uuid("77777777", stepNo + 10)] });
  return {
    id: uuid("88888888", i),
    organizationId: ORG,
    code: `kzn-control-room-critical-${i}`,
    name: `KZN control room critical escalation ${i}`,
    steps: [step(1), step(2), step(3)],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const range = <T>(count: number, row: (i: number) => T): T[] => Array.from({ length: count }, (_, i) => row(i));

/** One service set for every list here: `count` live-length rows each. */
function fake(count: number) {
  const alarms = range(count, alarm);
  const services = {
    access: { readableAssetIdsInOrganization: async () => ASSETS },
    locationScope: { readableAssetIdsInLocations: async () => ({ ok: true, organizationId: ORG, assetIds: ASSETS }) },
    alarms: { list: async (opts: { limit: number; cursor?: string }) => keysetPage(alarms, opts.limit, opts.cursor) },
    assets: { listAll: async () => range(count, asset) },
    locations: { list: async () => ({ items: range(count, location) }) },
    rules: { listRules: async () => ({ items: range(count, rule) }) },
    workOrders: { list: async () => ({ items: range(count, workOrder) }) },
    maintenance: { list: async () => ({ items: range(count, schedule) }) },
    dashboards: { list: async () => ({ items: range(count, dashboard) }) },
    schedules: { list: async () => range(count, reportSchedule) },
    escalationProfiles: {
      list: async () => range(count, profile),
      getDefaults: async () => ({ organizationId: ORG, items: [{ severity: "critical", profileId: uuid("88888888", 0), profileCode: "kzn-control-room-critical-0" }] }),
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), alarms };
}

type Page = { truncated: boolean; nextCursor?: string | null; organizations: Array<{ items: Array<{ id: string }> }> };

/** What the model receives for one call: the turn service's `succeed(scrubToolResult(result))`. */
async function contentOf(tools: ReturnType<typeof fake>["tools"], name: string, args: Record<string, unknown>): Promise<string> {
  const out: CopilotToolResult = await tools.dispatch(name, args, ctx());
  if (!out.ok) throw new Error(`F4.291: ${name} refused: ${out.error}`);
  return succeed(scrubToolResult(out.result)).content;
}

/** The content as the model parses it; throws on a cut (the fixed tail makes it invalid JSON). */
function parsed(content: string): Page {
  return JSON.parse(content) as Page;
}

const idsOf = (page: Page) => page.organizations.flatMap((entry) => entry.items.map((item) => item.id));

/**
 * Every page of `name` from no cursor to `nextCursor: null`, as the model
 * receives it: each must parse (none is cut), and the ids are collected.
 */
async function walk(tools: ReturnType<typeof fake>["tools"], name: string): Promise<{ pages: Page[]; ids: string[] }> {
  const pages: Page[] = [];
  let cursor: string | undefined;
  for (let call = 0; call < 20; call += 1) {
    const page = parsed(await contentOf(tools, name, cursor === undefined ? {} : { cursor }));
    pages.push(page);
    if (page.nextCursor == null) break;
    cursor = page.nextCursor;
  }
  return { pages, ids: pages.flatMap(idsOf) };
}

// --- list_alarms: the live defect ----------------------------------------------------------------

/** (a1) A full 25-row live-length alarm page reaches the model as whole JSON: no cut tail, within the bound. */
export async function aFullAlarmPageIsWholeJson(): Promise<void> {
  const { tools } = fake(60);
  const content = await contentOf(tools, "list_alarms", { state: "all" });
  expect(content.endsWith(TOOL_RESULT_CUT_TAIL)).toBe(false);
  expect(content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
  expect(() => parsed(content)).not.toThrow();
}

/** (a2) That page says it is cut and how to go on: `truncated: true` and a cursor. */
export async function aFittedAlarmPageCarriesTruncatedAndACursor(): Promise<void> {
  const { tools } = fake(60);
  const page = parsed(await contentOf(tools, "list_alarms", { state: "all" }));
  expect([page.truncated, typeof page.nextCursor]).toEqual([true, "string"]);
}

/** (a3) Following the cursors returns every alarm once, newest first: no row skipped, none repeated. */
export async function followingAlarmCursorsSkipsAndRepeatsNothing(): Promise<void> {
  const { tools, alarms } = fake(60);
  const { ids } = await walk(tools, "list_alarms");
  expect(ids).toEqual(keysetPage(alarms, alarms.length, undefined).items.map((row) => row.id));
}

// --- key order -------------------------------------------------------------------------------------

/** (b) `truncated` and `nextCursor` come before the rows, so a backstop cut never removes them. */
export async function thePagingKeysComeBeforeTheRows(): Promise<void> {
  const { tools } = fake(60);
  const content = await contentOf(tools, "list_alarms", { state: "all" });
  expect(content.startsWith('{"ok":true,"truncated":true,"nextCursor":"')).toBe(true);
}

/** (b2) An unpaged list puts `truncated` before its rows too. */
export async function anUnpagedListPutsTruncatedFirst(): Promise<void> {
  const { tools } = fake(2);
  const content = await contentOf(tools, "list_dashboards", {});
  expect(content.startsWith('{"ok":true,"truncated":false,"organizations":')).toBe(true);
}

/** (b3) A list within the budget is not shortened: 3 rows in, 3 rows out, `truncated: false`. */
export async function aListWithinTheBudgetIsUnchanged(): Promise<void> {
  const { tools } = fake(3);
  const page = parsed(await contentOf(tools, "list_alarms", { state: "all" }));
  expect([idsOf(page).length, page.truncated, page.nextCursor]).toEqual([3, false, null]);
}

// --- (c) every other list whose realistic 25-row page passes the budget --------------------------

/** A paged list's walk: every page whole JSON within the budget, and every row once. */
async function pagedWalkIsWholeAndComplete(name: string, all: readonly { id: string }[]): Promise<void> {
  const { tools } = fake(all.length);
  const { pages, ids } = await walk(tools, name);
  expect(pages.length).toBeGreaterThan(2);
  expect([...ids].sort()).toEqual(all.map((row) => row.id).sort());
}

/** (c1) `list_assets`. */
export const listAssetsPagesAreWhole = () => pagedWalkIsWholeAndComplete("list_assets", range(60, asset));
/** (c2) `list_rules`. */
export const listRulesPagesAreWhole = () => pagedWalkIsWholeAndComplete("list_rules", range(60, rule));
/** (c3) `list_locations`. */
export const listLocationsPagesAreWhole = () => pagedWalkIsWholeAndComplete("list_locations", range(60, location));
/** (c4) `list_work_orders`. */
export const listWorkOrdersPagesAreWhole = () => pagedWalkIsWholeAndComplete("list_work_orders", range(60, workOrder));
/** (c5) `list_maintenance_schedules`. */
export const listMaintenancePagesAreWhole = () => pagedWalkIsWholeAndComplete("list_maintenance_schedules", range(60, schedule));

/** An unpaged list of 25 live-length rows: whole JSON, within the budget, and `truncated: true`. */
async function unpagedPageIsWhole(name: string): Promise<void> {
  const { tools } = fake(25);
  const content = await contentOf(tools, name, {});
  expect(content.length).toBeLessThanOrEqual(COPILOT_TOOL_RESULT_BUDGET_CHARS + `{"ok":true,`.length);
  expect(parsed(content).truncated).toBe(true);
}

/** (c6) `list_dashboards`. */
export const listDashboardsPageIsWhole = () => unpagedPageIsWhole("list_dashboards");
/** (c7) `list_report_schedules`. */
export const listReportSchedulesPageIsWhole = () => unpagedPageIsWhole("list_report_schedules");
/** (c8) `list_escalation_profiles`. */
export const listEscalationProfilesPageIsWhole = () => unpagedPageIsWhole("list_escalation_profiles");
