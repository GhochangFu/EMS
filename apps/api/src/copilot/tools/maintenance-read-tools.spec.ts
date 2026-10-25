import { expect } from "vitest";

import type { JwtPayload, MaintenanceScheduleItem } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { MAINTENANCE_LIST_LIMIT } from "../../maintenance/maintenance.service";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { organizationOutOfScope } from "./copilot-tool-scope";

/**
 * `F4.281` (ADR 0099 Amendment 8 D7; owner ruling DC4) — `list_maintenance_schedules`
 * over a fake `MaintenanceService` that logs its calls. One call per organization
 * with that organization's readable asset ids, never `null` or `[]`, with no
 * due-date window, and inactive rows only on request. The fake applies what the
 * service's SQL applies — the asset, the inactive filter, the title search and
 * the `MAINTENANCE_LIST_LIMIT` cap — so a filter left to the tool after the cap
 * shows. Vitest entry point: the sibling `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const ORG_EMPTY = "00000000-0000-4000-8000-0000000000dd";
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const ASSET_X = "30000000-0000-4000-8000-0000000000aa";
const ASSET_X2 = "30000000-0000-4000-8000-0000000000a2";
const ASSET_Y = "30000000-0000-4000-8000-0000000000bb";

const ASSETS_BY_ORG: Record<string, string[]> = { [ORG_X]: [ASSET_X, ASSET_X2], [ORG_Y]: [ASSET_Y], [ORG_EMPTY]: [] };

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: { id: USER, role: "asset_group_admin", organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role: "asset_group_admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-10-24T06:00:00Z"),
  };
}

function schedule(index: number, over: Partial<MaintenanceScheduleItem> = {}): MaintenanceScheduleItem {
  const n = String(index).padStart(2, "0");
  return {
    id: `40000000-0000-4000-8000-0000000000${n}`,
    templateId: `50000000-0000-4000-8000-0000000000${n}`,
    assetId: ASSET_X,
    title: `Schedule ${n}`,
    description: "A long description the tool drops",
    category: "preventive",
    generationMode: "calendar",
    ownerTeam: null,
    vendorName: null,
    complianceRef: null,
    triggerSummary: "A trigger summary the tool drops",
    safetyCritical: false,
    priority: "medium",
    estimatedMinutes: 60,
    intervalDays: 90,
    nextDueAt: "2026-11-01T09:00:00.000Z",
    lastCompletedAt: null,
    dueState: "upcoming",
    assetCode: "CH-2",
    assetName: "Chiller 2",
    siteName: "Pune Works",
    activeWorkOrderId: null,
    active: true,
    ...over,
  };
}

type Call = { assetIds: readonly string[] | null | undefined; query: Record<string, unknown>; options: unknown };

function fake(byOrg: Record<string, MaintenanceScheduleItem[]>) {
  const log: Call[] = [];
  const services = {
    access: {
      readableAssetIdsInOrganization: async (_user: JwtPayload, organizationId: string) => ASSETS_BY_ORG[organizationId] ?? [],
    },
    maintenance: {
      list: async (query: Record<string, unknown>, assetIds?: string[] | null, options?: unknown) => {
        log.push({ assetIds, query, options });
        const owner = Object.keys(ASSETS_BY_ORG).find((org) => (ASSETS_BY_ORG[org] ?? []).includes(assetIds?.[0] ?? ""));
        const needle = (options as { titleSearch?: string } | undefined)?.titleSearch?.toLowerCase();
        const rows = (owner ? (byOrg[owner] ?? []) : []).filter(
          (row) =>
            (query.includeInactive === true || row.active) &&
            (query.assetId === undefined || row.assetId === query.assetId) &&
            (needle === undefined || row.title.toLowerCase().includes(needle)),
        );
        return { items: rows.slice(0, MAINTENANCE_LIST_LIMIT) };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), log };
}

type Listed = { organizations: { organizationId: string; items: Record<string, unknown>[] }[]; truncated: boolean };

async function list(tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown>, allowed: readonly string[]) {
  const result: CopilotToolResult = await tools.dispatch("list_maintenance_schedules", args, ctx(allowed));
  if (!result.ok) throw new Error(result.error);
  return result.result as unknown as Listed;
}

const itemsOf = (listed: Listed) => listed.organizations.flatMap((entry) => entry.items);

/** `list` is called once per organization with that organization's readable asset ids and no due-date window. */
export async function listIsCalledPerOrganizationWithItsAssetsAndNoWindow(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [schedule(1)], [ORG_Y]: [schedule(2, { assetId: ASSET_Y })] });
  await list(tools, {}, [ORG_X, ORG_Y]);
  expect(log.map((call) => call.assetIds)).toEqual([[ASSET_X, ASSET_X2], [ASSET_Y]]);
  for (const call of log) {
    expect(call.query).toMatchObject({ dueState: "all", priority: "all", includeInactive: false });
    expect(call.options).toEqual({ anyDueDate: true });
  }
}

/** An organization with no readable asset is not read. */
export async function anOrganizationWithNoReadableAssetIsNotRead(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [schedule(1)] });
  await list(tools, {}, [ORG_EMPTY, ORG_X]);
  expect(log.map((call) => call.assetIds)).toEqual([[ASSET_X, ASSET_X2]]);
}

/** Owner ruling DC4: `includeInactive` asks for and returns a deactivated schedule with `active: false`. */
export async function includeInactiveReturnsAnInactiveRow(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [schedule(1), schedule(2, { active: false })] });
  const items = itemsOf(await list(tools, { includeInactive: true }, [ORG_X]));
  expect(log[0]?.query.includeInactive).toBe(true);
  expect(items.map((item) => [item.title, item.active])).toEqual([
    ["Schedule 01", true],
    ["Schedule 02", false],
  ]);
}

/** The adjacent negative: without the flag the inactive row is not listed. */
export async function withoutTheFlagAnInactiveRowIsNotListed(): Promise<void> {
  const { tools } = fake({ [ORG_X]: [schedule(1), schedule(2, { active: false })] });
  expect(itemsOf(await list(tools, {}, [ORG_X])).map((item) => item.title)).toEqual(["Schedule 01"]);
}

/** `search` goes to the service as `titleSearch`, so it narrows in the SQL, before the service's row cap. */
export async function searchIsPassedToTheServiceAsTitleSearch(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [schedule(1)] });
  await list(tools, { search: "filter" }, [ORG_X]);
  expect(log[0]?.options).toEqual({ anyDueDate: true, titleSearch: "filter" });
}

/** `search` finds the 130th of 150 rows: the match is past the service's 100-row cap. */
export async function searchNarrowsBeforeTheCap(): Promise<void> {
  const rows = Array.from({ length: 150 }, (_, i) => schedule(i + 1, i === 129 ? { title: "Quarterly FILTER check" } : {}));
  const { tools } = fake({ [ORG_X]: rows });
  expect(itemsOf(await list(tools, { search: "filter" }, [ORG_X])).map((item) => item.title)).toEqual(["Quarterly FILTER check"]);
}

/** `assetId` narrows to the schedules on that asset. */
export async function assetIdNarrows(): Promise<void> {
  const { tools } = fake({ [ORG_X]: [schedule(1), schedule(2, { assetId: ASSET_X2 })] });
  expect(itemsOf(await list(tools, { assetId: ASSET_X2 }, [ORG_X])).map((item) => item.title)).toEqual(["Schedule 02"]);
}

/** 40 rows are cut to 25, and `truncated` says so. */
export async function fortyRowsAreCutToTwentyFive(): Promise<void> {
  const { tools } = fake({ [ORG_X]: Array.from({ length: 40 }, (_, i) => schedule(i + 1)) });
  const listed = await list(tools, {}, [ORG_X]);
  expect(itemsOf(listed)).toHaveLength(25);
  expect(listed.truncated).toBe(true);
}

/** An organization outside the allowed set is refused, and `list` is not called. */
export async function anOrganizationOutsideTheAllowedSetIsRefused(): Promise<void> {
  const { tools, log } = fake({ [ORG_X]: [schedule(1)] });
  const result = await tools.dispatch("list_maintenance_schedules", { organizationId: ORG_B }, ctx([ORG_X]));
  expect(result).toEqual({ ok: false, error: organizationOutOfScope([ORG_X]) });
  expect(log).toEqual([]);
}

/** The projection keeps what a proposal needs and drops the free-text fields. */
export async function theProjectionKeepsWhatAProposalNeeds(): Promise<void> {
  const { tools } = fake({ [ORG_X]: [schedule(1, { complianceRef: "IS 2026" })] });
  const [item] = itemsOf(await list(tools, {}, [ORG_X]));
  expect(Object.keys(item ?? {}).sort()).toEqual(
    [
      "id",
      "title",
      "assetId",
      "assetCode",
      "assetName",
      "category",
      "generationMode",
      "priority",
      "intervalDays",
      "nextDueAt",
      "dueState",
      "active",
      "safetyCritical",
      "complianceRef",
      "activeWorkOrderId",
    ].sort(),
  );
}
