import { expect } from "vitest";

import type { AdminUserDto, JwtPayload, WorkOrderListItem } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { organizationOutOfScope } from "./copilot-tool-scope";

/**
 * `F4.284` (ADR 0106; owner rulings DC1, DC7) — `list_work_orders` over a fake
 * `WorkOrdersService` that logs its calls (one per organization with that
 * organization's readable asset ids, never `null` or `[]`; the title search and the
 * status reach the service, which applies them before its 100-row cap), and
 * `list_users` over a fake `UsersService.list` (id, displayName, role — never an
 * email). Vitest entry point: the sibling `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";

const ASSETS_BY_ORG: Record<string, string[]> = { [ORG_X]: [ASSET_X], [ORG_Y]: [ASSET_Y] };

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: { id: USER, role: "organization_admin", organizationId: ORG_X } as ResolvedIdentity,
    user: { sub: USER, role: "organization_admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-10-25T06:00:00Z"),
  };
}

function workOrder(index: number, assetId: string, over: Partial<WorkOrderListItem> = {}): WorkOrderListItem {
  return {
    id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    assetId,
    alarmId: null,
    title: `Work order ${index}`,
    description: null,
    status: "open",
    priority: "medium",
    sortOrder: index,
    assignedTo: null,
    createdBy: null,
    dueAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: "2026-10-20T06:00:00.000Z",
    updatedAt: "2026-10-20T06:00:00.000Z",
    assetCode: "MCC-1",
    assetName: "MCC-1",
    siteName: "Pune Works",
    ...over,
  };
}

function user(id: string, organizationId: string | null, over: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    id,
    email: `${id.slice(0, 4)}@example.com`,
    displayName: `User ${id.slice(0, 4)}`,
    role: organizationId === null ? "admin" : "operator",
    organizationId,
    linked: true,
    disabledAt: null,
    lastLoginAt: null,
    createdAt: "2026-10-01T06:00:00.000Z",
    ...over,
  };
}

type Call = { opts: { limit: number; assetIds?: string[] | null }; options: unknown };

function fake(rows: WorkOrderListItem[], users: AdminUserDto[] = []) {
  const log: Call[] = [];
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => ASSETS_BY_ORG[organizationId] ?? [],
    },
    workOrders: {
      list: async (opts: { limit: number; assetIds?: string[] | null }, options?: { titleSearch?: string; status?: string }) => {
        log.push({ opts, options });
        const needle = options?.titleSearch?.toLowerCase();
        const items = rows.filter(
          (row) =>
            (opts.assetIds ?? []).includes(row.assetId) &&
            (needle === undefined || row.title.toLowerCase().includes(needle)) &&
            (options?.status === undefined || row.status === options.status),
        );
        return { items: items.slice(0, 100) };
      },
    },
    users: { list: async () => ({ items: users }) },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

type Listed = { organizations: { organizationId: string; items: Record<string, unknown>[] }[]; truncated: boolean };

async function dispatch(tools: ReturnType<typeof fake>["tools"], name: string, args: Record<string, unknown>, allowed: readonly string[]) {
  return tools.dispatch(name, args, ctx(allowed)) as Promise<CopilotToolResult>;
}

async function list(tools: ReturnType<typeof fake>["tools"], name: string, args: Record<string, unknown>, allowed: readonly string[]) {
  const result = await dispatch(tools, name, args, allowed);
  if (!result.ok) throw new Error(result.error);
  return { listed: result.result as unknown as Listed, organizationIds: result.organizationIds };
}

const itemsOf = (listed: Listed) => listed.organizations.flatMap((entry) => entry.items);

/** One call per allowed organization, each with that organization's readable assets. */
export async function listWorkOrdersReadsEachOrganizationWithItsAssets(): Promise<void> {
  const { tools, log } = fake([workOrder(1, ASSET_X), workOrder(2, ASSET_Y)]);
  await list(tools, "list_work_orders", {}, [ORG_X, ORG_Y]);
  expect(log.map((call) => call.opts.assetIds)).toEqual([[ASSET_X], [ASSET_Y]]);
}

/** The result names the organizations it read, and their items. */
export async function listWorkOrdersNamesTheOrganizationsItRead(): Promise<void> {
  const { tools } = fake([workOrder(1, ASSET_X), workOrder(2, ASSET_Y)]);
  const { listed, organizationIds } = await list(tools, "list_work_orders", {}, [ORG_X, ORG_Y]);
  expect(organizationIds).toEqual([ORG_X, ORG_Y]);
  expect(itemsOf(listed).map((item) => item.title)).toEqual(["Work order 1", "Work order 2"]);
}

/** DC7: `search` reaches the service as `titleSearch`, so a match past the 100-row cap is found. */
export async function listWorkOrdersSearchesInTheService(): Promise<void> {
  const rows = [...Array.from({ length: 120 }, (_, i) => workOrder(i, ASSET_X)), workOrder(500, ASSET_X, { title: "Replace the main lug" })];
  const { tools, log } = fake(rows);
  const { listed } = await list(tools, "list_work_orders", { search: "main lug" }, [ORG_X]);
  expect(log[0]?.options).toEqual({ titleSearch: "main lug" });
  expect(itemsOf(listed).map((item) => item.title)).toEqual(["Replace the main lug"]);
}

/** DC7: a status filter reaches the service and narrows. */
export async function listWorkOrdersFiltersByStatus(): Promise<void> {
  const { tools, log } = fake([workOrder(1, ASSET_X), workOrder(2, ASSET_X, { status: "closed" })]);
  const { listed } = await list(tools, "list_work_orders", { status: "closed" }, [ORG_X]);
  expect(log[0]?.options).toEqual({ status: "closed" });
  expect(itemsOf(listed).map((item) => item.status)).toEqual(["closed"]);
}

/** The items are cut at 25, and `truncated` says there are more. */
export async function listWorkOrdersCapsAt25(): Promise<void> {
  const { tools } = fake(Array.from({ length: 40 }, (_, i) => workOrder(i, ASSET_X)));
  const { listed } = await list(tools, "list_work_orders", {}, [ORG_X]);
  expect([itemsOf(listed).length, listed.truncated]).toEqual([25, true]);
}

/** An organization outside the turn's scope is refused, and nothing is read. */
export async function listWorkOrdersRefusesAnOrganizationOutsideTheScope(): Promise<void> {
  const { tools, log } = fake([workOrder(1, ASSET_X)]);
  const result = await dispatch(tools, "list_work_orders", { organizationId: ORG_B }, [ORG_X]);
  expect(result).toEqual({ ok: false, error: organizationOutOfScope([ORG_X]) });
  expect(log).toEqual([]);
}

/** DC1: a user row holds id, displayName and role. */
export async function listUsersListsIdNameAndRole(): Promise<void> {
  const operator = user("70000000-0000-4000-8000-000000000001", ORG_X);
  const { tools } = fake([], [operator]);
  const { listed } = await list(tools, "list_users", {}, [ORG_X]);
  expect(itemsOf(listed)).toEqual([{ id: operator.id, displayName: operator.displayName, role: "operator" }]);
}

/** DC1: an email address never reaches the model. */
export async function listUsersNeverShowsAnEmail(): Promise<void> {
  const { tools } = fake([], [user("70000000-0000-4000-8000-000000000001", ORG_X)]);
  const result = await dispatch(tools, "list_users", {}, [ORG_X]);
  expect(JSON.stringify(result)).not.toContain("@example.com");
  expect(Object.keys(itemsOf((result as unknown as { result: Listed }).result)[0] ?? {})).not.toContain("email");
}

/** DC1: a global admin, a disabled account and another organization's user are not listed. */
export async function listUsersListsOnlyTheOrganizationsActiveUsers(): Promise<void> {
  const users = [
    user("70000000-0000-4000-8000-000000000001", ORG_X),
    user("70000000-0000-4000-8000-000000000002", null),
    user("70000000-0000-4000-8000-000000000003", ORG_X, { disabledAt: "2026-10-02T06:00:00.000Z" }),
    user("70000000-0000-4000-8000-000000000004", ORG_B),
  ];
  const { tools } = fake([], users);
  const { listed } = await list(tools, "list_users", {}, [ORG_X]);
  expect(itemsOf(listed).map((item) => item.id)).toEqual(["70000000-0000-4000-8000-000000000001"]);
}

/** An organization outside the turn's scope is refused. */
export async function listUsersRefusesAnOrganizationOutsideTheScope(): Promise<void> {
  const { tools } = fake([], [user("70000000-0000-4000-8000-000000000004", ORG_B)]);
  expect(await dispatch(tools, "list_users", { organizationId: ORG_B }, [ORG_X])).toEqual({ ok: false, error: organizationOutOfScope([ORG_X]) });
}

/*
 * `F4.284` owner ruling 2026-10-25 (Q4): `list_alarm_skills` — the active alarm skill vocabulary
 * (ADR 0034) the enrichment route accepts, over a fake `VocabulariesService.list`.
 */
const SKILLS = [
  { code: "electrical", label: "Electrical", sortOrder: 10, active: true },
  { code: "retired_trade", label: "Retired", sortOrder: 15, active: false },
  { code: "hvac", label: "HVAC", sortOrder: 30, active: true },
];

function skillsFake(alarmSkills: unknown) {
  const services = {
    vocabularies: {
      list: async () => ({ ruleCategories: [], assetDomains: [], alarmSeverities: [], alarmSkills, assetRoles: [], dashboardSections: [] }),
    },
  } as unknown as CopilotReadServices;
  return createCopilotReadTools(services);
}

/** The active skills, code and label only, in the service's order; a fleet vocabulary names no organization. */
export async function listAlarmSkillsListsTheActiveCodesAndLabels(): Promise<void> {
  expect(await skillsFake(SKILLS).dispatch("list_alarm_skills", {}, ctx([ORG_X]))).toEqual({
    ok: true,
    result: { items: [{ code: "electrical", label: "Electrical" }, { code: "hvac", label: "HVAC" }] },
    organizationIds: [],
  });
}

/** The service's rows go through the guarded parse: a row off its contract is a refusal, never a pass-through. */
export async function listAlarmSkillsParsesTheServicesRows(): Promise<void> {
  await expect(skillsFake([{ code: 7, label: "Bad" }]).dispatch("list_alarm_skills", {}, ctx([ORG_X]))).rejects.toThrow();
}

/** The tool takes no argument (strict): an organization id is refused by the schema. */
export function listAlarmSkillsTakesNoArgument(): void {
  const tools = skillsFake(SKILLS);
  const definition = tools.registry.definitions.find((d) => d.name === "list_alarm_skills");
  expect(definition?.parameters).toMatchObject({ type: "object", properties: {}, additionalProperties: false });
}
