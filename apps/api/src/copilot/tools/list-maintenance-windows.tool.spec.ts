import { expect } from "vitest";

import type { JwtPayload, MaintenanceWindowItem } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { UNRESTRICTED_SCOPE, type MaintenanceWindowReadScope } from "../../maintenance-windows/maintenance-window-scope";
import type { MaintenanceWindowListQuery } from "../../maintenance-windows/maintenance-windows.schema";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { createCopilotReadTools } from "./copilot-read-tool-set";
import { organizationOutOfScope } from "./copilot-tool-scope";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decision 6, ruling Q3) —
 * `list_maintenance_windows` over a fake `MaintenanceWindowsService` that logs
 * its calls. The tool reads the windows page's own read with the caller's own
 * window scope (`readScopeFor`: the three readable sets and the subtree grant),
 * one call per allowed organization, each filter passed through the route's own
 * query schema. Vitest entry point: the sibling `.test.ts`.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const ORG_B = "00000000-0000-4000-8000-0000000000cc";
const ASSET = "30000000-0000-4000-8000-0000000000aa";
const SITE = "40000000-0000-4000-8000-0000000000aa";

function ctx(allowed: readonly string[], role = "location_admin"): CopilotToolContext {
  return {
    identity: { id: USER, role, organizationId: null } as ResolvedIdentity,
    user: { sub: USER, role } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date("2026-11-13T06:00:00Z"),
  };
}

export function windowItem(index: number, organizationId = ORG_X, over: Partial<MaintenanceWindowItem> = {}): MaintenanceWindowItem {
  const n = String(index).padStart(2, "0");
  return {
    id: `60000000-0000-4000-8000-0000000000${n}`,
    organizationId,
    reason: `Compressor overhaul on chiller ${n}`,
    startsAt: "2026-11-13T05:00:00.000Z",
    endsAt: "2026-11-13T18:00:00.000Z",
    endedAt: null,
    state: "active",
    createdByName: "Site Admin",
    endedByName: null,
    workOrder: null,
    maintenanceSchedule: null,
    targets: [{ kind: "asset", id: ASSET, label: "Chiller 2" }],
    assetIds: [ASSET, "30000000-0000-4000-8000-0000000000a2"],
    ...over,
  };
}

type Call = { query: MaintenanceWindowListQuery; scope: MaintenanceWindowReadScope };

function fake(admin: boolean, rows: Record<string, MaintenanceWindowItem[]> = { [ORG_X]: [windowItem(1)] }) {
  const calls: Call[] = [];
  const services = {
    access: {
      isGlobalAdmin: async () => admin,
      currentUser: async () => ({
        scope: { kind: "location", assetIds: [ASSET], assetGroups: [], locations: [{ id: SITE }] },
      }),
      readableOrganizationIds: async () => [ORG_X, ORG_Y],
    },
    maintenanceWindows: {
      list: async (query: MaintenanceWindowListQuery, scope: MaintenanceWindowReadScope) => {
        calls.push({ query, scope });
        return { items: (rows[query.organizationId ?? ""] ?? []).slice(0, query.limit) };
      },
    },
  } as unknown as CopilotReadServices;
  return { tools: createCopilotReadTools(services), calls };
}

async function run(tools: ReturnType<typeof fake>["tools"], args: Record<string, unknown>, allowed: readonly string[], role?: string) {
  return tools.dispatch("list_maintenance_windows", args, ctx(allowed, role)) as Promise<CopilotToolResult>;
}

/** Decision 6: the tool passes the caller's own readable sets, the subtree grant with them — the route's scope. */
export async function theToolPassesTheCallersReadableSets(): Promise<void> {
  const { tools, calls } = fake(false);
  await run(tools, {}, [ORG_X]);
  expect(calls.map((call) => call.scope)).toEqual([
    { assetIds: [ASSET], locationIds: [SITE], organizationIds: [ORG_X, ORG_Y], subtreeLocationIds: [SITE] },
  ]);
}

/** The admin's scope is unrestricted, as the route's is. */
export async function theAdminPassesTheUnrestrictedScope(): Promise<void> {
  const { tools, calls } = fake(true);
  await run(tools, {}, [ORG_X], "admin");
  expect(calls[0]?.scope).toEqual(UNRESTRICTED_SCOPE);
}

/** One call per allowed organization, each named; the filters go through the route's own query schema (lower-cased ids). */
export async function oneCallPerAllowedOrganizationWithTheFilters(): Promise<void> {
  const { tools, calls } = fake(false);
  await run(tools, { state: "future", assetId: ASSET.toUpperCase(), locationId: SITE.toUpperCase() }, [ORG_X, ORG_Y]);
  expect(calls.map((call) => call.query)).toEqual([
    { organizationId: ORG_X, state: "future", assetId: ASSET, locationId: SITE, limit: 26 },
    { organizationId: ORG_Y, state: "future", assetId: ASSET, locationId: SITE, limit: 25 },
  ]);
}

/** A named organization outside the turn's allowed set is refused before any read. */
export async function anOrganizationOutsideTheTurnIsRefused(): Promise<void> {
  const { tools, calls } = fake(false);
  expect(await run(tools, { organizationId: ORG_B }, [ORG_X])).toEqual({ ok: false, error: organizationOutOfScope([ORG_X]) });
  expect(calls).toEqual([]);
}

/** An item carries the ids a write names, its state, period and labelled targets; an active one's readable covered assets as a count. */
export async function anItemCarriesWhatAWriteNames(): Promise<void> {
  const { tools } = fake(false);
  const out = await run(tools, {}, [ORG_X]);
  if (!out.ok) throw new Error(out.error);
  const organizations = (out.result as { organizations: Array<{ organizationId: string; items: unknown[] }> }).organizations;
  expect(organizations).toEqual([
    {
      organizationId: ORG_X,
      items: [
        {
          id: windowItem(1).id,
          reason: "Compressor overhaul on chiller 01",
          state: "active",
          startsAt: "2026-11-13T05:00:00.000Z",
          endsAt: "2026-11-13T18:00:00.000Z",
          endedAt: null,
          targets: [{ kind: "asset", id: ASSET, label: "Chiller 2" }],
          targetCount: 1,
          readableCoveredAssetCount: 2,
          workOrder: null,
          maintenanceSchedule: null,
        },
      ],
    },
  ]);
  expect(out.organizationIds).toEqual([ORG_X]);
}

/** More rows than the room: the list is cut at 25 and says so. */
export async function aFullOrganizationIsTruncated(): Promise<void> {
  const { tools } = fake(false, { [ORG_X]: Array.from({ length: 40 }, (_, i) => windowItem(i)) });
  const out = await run(tools, {}, [ORG_X]);
  if (!out.ok) throw new Error(out.error);
  expect((out.result as { truncated: boolean }).truncated).toBe(true);
}

/**
 * Review of PR 6: an item names at most its first 10 targets, with the full `targetCount`; the
 * readable covered-asset count is given for an active window only (the service fills it for no other).
 */
export async function anItemCapsItsTargetsAndCountsOnlyAnActiveWindow(): Promise<void> {
  const many = Array.from({ length: 30 }, (_, i) => ({ kind: "asset" as const, id: `30000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, label: `Pump ${i}` }));
  const { tools } = fake(false, { [ORG_X]: [windowItem(1, ORG_X, { targets: many }), windowItem(2, ORG_X, { state: "future", assetIds: [] })] });
  const out = await run(tools, {}, [ORG_X]);
  if (!out.ok) throw new Error(out.error);
  const items = (out.result as { organizations: Array<{ items: Array<Record<string, unknown>> }> }).organizations[0]?.items ?? [];
  expect(items.map((item) => [(item.targets as unknown[]).length, item.targetCount, item.readableCoveredAssetCount])).toEqual([
    [10, 30, 2],
    [1, 1, undefined],
  ]);
  expect(items[0]?.targets).toEqual(many.slice(0, 10));
  expect("readableCoveredAssetCount" in (items[1] ?? {})).toBe(false);
}
