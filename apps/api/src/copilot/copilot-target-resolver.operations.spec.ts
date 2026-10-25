import { expect } from "vitest";

import type { JwtPayload, UserRole } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import { canPerformOperationsWrite, type OperationsWriteClass } from "../auth/operations-write";
import { CopilotTargetResolver } from "./copilot-target-resolver";

/**
 * `F4.284` (ADR 0106 decision 6; ADR 0099 Amendment 8 D2; owner rulings DC1, DC5) —
 * the `alarm`, `workOrder`, `workOrderBatch` and `maintenanceScheduleConvert` targets,
 * and the `user` and `alarm` refs. Each mirrors its route: `assertOperationsWriteRole(user,
 * "operational")` (the real role rule here, `canPerformOperationsWrite`), then the row's
 * (or the body's) asset in the caller's **read** scope. Vitest entry point: the sibling
 * `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const ROW = "22222222-2222-4222-8222-222222222222";
const ROW_2 = "66666666-6666-4666-8666-666666666666";
const ASSET = "44444444-4444-4444-8444-444444444444";
const OTHER_ASSET = "55555555-5555-4555-8555-555555555555";
const USER = "77777777-7777-4777-8777-777777777777";
const RAISED = new Date("2026-10-24T08:15:00.000Z");

type World = {
  /** The organization every row is in; a read under another organization finds nothing. */
  rowOrg: string;
  /** Work orders by id (the batch read answers those of the asked ids). */
  workOrders: Record<string, { title: string; status: string; sortOrder: number; assetId: string }>;
  /**
   * Whether a ref read (`refBelongs`: an assignee, an alarm, an affected asset) finds its row in the
   * change's organization. The organization predicate itself is SQL; the integration suite runs it.
   */
  refFound: boolean;
  scheduleActive: boolean;
  openWorkOrder: boolean;
};

const BASE: World = {
  rowOrg: ORG,
  workOrders: {
    [ROW]: { title: "Check the breaker", status: "open", sortOrder: 0, assetId: ASSET },
    [ROW_2]: { title: "Replace the lug", status: "assigned", sortOrder: 1, assetId: ASSET },
  },
  refFound: true,
  scheduleActive: true,
  openWorkOrder: false,
};

/**
 * A database for one world. `withTenant` sets the organization through `execute`; every
 * `select` reads which columns it names, and the awaited chain answers the rows of that read.
 * The `where` arguments are drizzle SQL, so the id a read asks for is taken from the world.
 */
function worldDb(world: World, ask: { org: string | null; id?: string; ids?: string[] }): never {
  const answer = (keys: string[]): unknown[] => {
    const inOrg = ask.org === null || ask.org === world.rowOrg;
    if (keys.includes("message")) {
      return inOrg
        ? [{ message: "Main breaker tripped", severity: "critical", raisedAt: RAISED, acknowledgedAt: null, assetId: ASSET, assetName: "MCC-1" }]
        : [];
    }
    if (keys.includes("sortOrder")) {
      if (!inOrg) return [];
      return (ask.ids ?? []).flatMap((id) => (world.workOrders[id] ? [{ id, ...world.workOrders[id] }] : []));
    }
    if (keys.includes("scheduleActive")) {
      return inOrg ? [{ title: "Quarterly check", assetId: ASSET, assetName: "AHU 4", scheduleActive: world.scheduleActive, templateActive: true }] : [];
    }
    if (keys.includes("workOrderId")) return world.openWorkOrder ? [{ workOrderId: ROW }] : [];
    if (keys.includes("status")) {
      const row = world.workOrders[ask.id ?? ROW];
      return inOrg && row ? [{ title: row.title, status: row.status, assetId: row.assetId, assetName: "MCC-1" }] : [];
    }
    // `bms.users` carries FORCE RLS: outside a tenant transaction (`org: null`) it answers nothing.
    if (keys.includes("displayName")) return ask.org !== null && inOrg && world.refFound ? [{ id: USER, displayName: "Asha Rao" }] : [];
    if (keys.length === 1 && keys[0] === "id") return world.refFound ? [{ id: "found" }] : [];
    return [{ name: "MCC-1" }];
  };
  let selected: string[] = [];
  const chain: Record<string, unknown> = {
    select: (columns: Record<string, unknown> = {}) => {
      selected = Object.keys(columns);
      return chain;
    },
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (rows: unknown[]) => void) => resolve(answer(selected)),
    execute: async () => undefined,
  };
  const db = {
    ...chain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(chain),
  };
  return db as never;
}

/** The route's two calls with the real role rule; `asked` records the order. */
function operationsAccess(readable: string[] | null, asked: string[]): never {
  return {
    assertOperationsWriteRole: async (user: JwtPayload, writeClass: OperationsWriteClass) => {
      asked.push(`role:${writeClass}`);
      if (!canPerformOperationsWrite(user.role as UserRole, writeClass)) throw new Error("403");
    },
    readableAssetIds: async () => {
      asked.push("readableAssetIds");
      return readable;
    },
  } as never;
}

async function resolveAs(
  id: string,
  role: string,
  readable: string[] | null,
  options: { body?: Record<string, unknown>; asked?: string[]; allowed?: string[]; world?: Partial<World>; params?: Record<string, string> } = {},
) {
  const world = { ...BASE, ...options.world };
  const body = options.body ?? { reason: "Panel checked" };
  const items = Array.isArray(body.items) ? (body.items as Array<{ id: string }>).map((item) => item.id) : undefined;
  const allowed = options.allowed ?? [ORG];
  // Each allowed organization is read under its own tenant, in order: the fake answers for the row's.
  const dbs = allowed.map((org) => worldDb(world, { org, id: options.params?.id ?? ROW, ...(items ? { ids: items } : {}) }));
  let call = 0;
  const tenantDb = new Proxy(worldDb(world, { org: null, id: ROW, ...(items ? { ids: items } : {}) }) as object, {
    get: (target, key) =>
      key === "transaction"
        ? async (fn: (tx: unknown) => Promise<unknown>) => {
            const db = (dbs[Math.min(call, dbs.length - 1)] ?? target) as { transaction: (f: typeof fn) => Promise<unknown> };
            call += 1;
            return db.transaction(fn);
          }
        : (target as Record<string | symbol, unknown>)[key],
  });
  const resolver = new CopilotTargetResolver(tenantDb as never, operationsAccess(readable, options.asked ?? []), {} as never, {} as never);
  const entry = catalogEntry(id)!;
  const params = options.params ?? (entry.path.includes(":id") ? { id: ROW } : {});
  const user = { sub: "f4284-resolver-unit", role } as JwtPayload;
  return resolver.resolve(entry, params, body, allowed, user, ORG);
}

const COPILOT_ROLES = ["admin", "organization_admin", "location_admin", "asset_group_admin"];
const BATCH = { items: [{ id: ROW, status: "assigned", sortOrder: 0 }, { id: ROW_2, status: "assigned", sortOrder: 1 }] };

/** Each copilot role with the alarm's asset readable resolves the ack, asking the operational class then the scope. */
export async function everyCopilotRoleResolvesTheAlarm(): Promise<void> {
  for (const role of COPILOT_ROLES) {
    const asked: string[] = [];
    expect((await resolveAs("alarm.acknowledge", role, [ASSET], { asked }))?.targetName, role).toBe("MCC-1");
    expect(asked, role).toEqual(["role:operational", "readableAssetIds"]);
  }
}

/** A viewer is the only role the route refuses: refused before the scope is read. */
export async function aViewerIsRefusedTheAlarm(): Promise<void> {
  const asked: string[] = [];
  expect(await resolveAs("alarm.acknowledge", "viewer", [ASSET], { asked })).toBeNull();
  expect(asked).toEqual(["role:operational"]);
}

/** An alarm whose asset is outside the read scope is refused. */
export async function anAlarmOutsideTheScopeIsRefused(): Promise<void> {
  expect(await resolveAs("alarm.acknowledge", "location_admin", [OTHER_ASSET])).toBeNull();
}

/** The alarm target carries the alarm the card names, and its organization. */
export async function theAlarmTargetCarriesTheAlarm(): Promise<void> {
  const resolved = await resolveAs("alarm.acknowledge", "admin", null);
  expect({ organizationId: resolved?.organizationId, alarm: resolved?.alarm }).toEqual({
    organizationId: ORG,
    alarm: { message: "Main breaker tripped", severity: "critical", assetName: "MCC-1", raisedAt: RAISED.toISOString(), acknowledgedAt: null },
  });
}

/** An alarm in no allowed organization is refused. */
export async function anAlarmInAnotherOrganizationIsRefused(): Promise<void> {
  expect(await resolveAs("alarm.acknowledge", "admin", null, { world: { rowOrg: OTHER_ORG } })).toBeNull();
}

/** An enrichment naming an affected asset outside the read scope is refused. */
export async function anEnrichmentWithAnUnreadableAffectedAssetIsRefused(): Promise<void> {
  const body = { rootCause: "Loose lug", affectedAssetIds: [OTHER_ASSET] };
  expect(await resolveAs("alarm.enrichment.set", "location_admin", [ASSET], { body })).toBeNull();
  expect((await resolveAs("alarm.enrichment.set", "location_admin", [ASSET, OTHER_ASSET], { body }))?.targetName).toBe("MCC-1");
}

/** An enrichment naming an affected asset the alarm's organization does not hold is refused. */
export async function anEnrichmentWithAForeignAffectedAssetIsRefused(): Promise<void> {
  const body = { rootCause: "Loose lug", affectedAssetIds: [OTHER_ASSET] };
  expect(await resolveAs("alarm.enrichment.set", "admin", null, { body, world: { refFound: false } })).toBeNull();
}

/** Each copilot role resolves a work-order status change by title, through the operational class. */
export async function everyCopilotRoleResolvesTheWorkOrder(): Promise<void> {
  for (const role of COPILOT_ROLES) {
    const asked: string[] = [];
    const resolved = await resolveAs("workOrder.close", role, [ASSET], { asked });
    expect({ name: resolved?.targetName, workOrder: resolved?.workOrder }, role).toEqual({
      name: "Check the breaker",
      workOrder: { title: "Check the breaker", status: "open", assetName: "MCC-1" },
    });
    expect(asked, role).toEqual(["role:operational", "readableAssetIds"]);
  }
}

/** A viewer is refused a work order. */
export async function aViewerIsRefusedTheWorkOrder(): Promise<void> {
  expect(await resolveAs("workOrder.setStatus", "viewer", [ASSET], { body: { status: "open" } })).toBeNull();
}

/** A work-order create resolves the body's asset and refuses one outside the read scope. */
export async function theCreateResolvesTheBodysAsset(): Promise<void> {
  const body = { assetId: ASSET, title: "Check the breaker" };
  expect((await resolveAs("workOrder.create", "location_admin", [ASSET], { body }))?.targetName).toBe("MCC-1");
  expect(await resolveAs("workOrder.create", "location_admin", [OTHER_ASSET], { body })).toBeNull();
}

/** A reorder resolves its organization and carries every work order as it is now. */
export async function theReorderCarriesTheBatch(): Promise<void> {
  const resolved = await resolveAs("workOrder.reorder", "organization_admin", [ASSET], { body: BATCH });
  expect(resolved?.batch?.map((row) => [row.id, row.status, row.sortOrder])).toEqual([
    [ROW, "open", 0],
    [ROW_2, "assigned", 1],
  ]);
}

/** A reorder naming a work order that no allowed organization has is refused. */
export async function aReorderWithAMissingWorkOrderIsRefused(): Promise<void> {
  const body = { items: [...BATCH.items, { id: OTHER_ASSET, status: "open", sortOrder: 2 }] };
  expect(await resolveAs("workOrder.reorder", "admin", null, { body })).toBeNull();
}

/** A reorder naming the same work order twice is refused. */
export async function aReorderWithADuplicateIsRefused(): Promise<void> {
  const body = { items: [BATCH.items[0], BATCH.items[0]] };
  expect(await resolveAs("workOrder.reorder", "admin", null, { body })).toBeNull();
}

/** A reorder naming a work order outside the read scope is refused. */
export async function aReorderOutsideTheScopeIsRefused(): Promise<void> {
  const world = { workOrders: { ...BASE.workOrders, [ROW_2]: { title: "Replace the lug", status: "assigned", sortOrder: 1, assetId: OTHER_ASSET } } };
  expect(await resolveAs("workOrder.reorder", "location_admin", [ASSET], { body: BATCH, world })).toBeNull();
}

/** The convert runs the operational class (not configuration) and carries whether the route would convert it. */
export async function theConvertRunsTheOperationalGate(): Promise<void> {
  const asked: string[] = [];
  const resolved = await resolveAs("maintenanceSchedule.convert", "location_admin", [ASSET], { asked, body: {} });
  expect({ name: resolved?.targetName, convertible: resolved?.convertible }).toEqual({
    name: "Quarterly check",
    convertible: { active: true, hasActiveWorkOrder: false },
  });
  expect(asked).toEqual(["role:operational", "readableAssetIds"]);
}

/** An assignee the change's organization holds is a ref that belongs, read under its tenant (RLS). */
export async function anAssigneeOfTheOrganizationBelongs(): Promise<void> {
  const body = { assetId: ASSET, title: "Check the breaker", assignedTo: USER };
  expect((await resolveAs("workOrder.create", "admin", null, { body }))?.targetName).toBe("MCC-1");
}

/** The resolved assignee's display name is the target's `refName`, so the card names the person. */
export async function theAssigneeIsNamed(): Promise<void> {
  const body = { assetId: ASSET, title: "Check the breaker", assignedTo: USER };
  expect((await resolveAs("workOrder.create", "admin", null, { body }))?.refName).toBe("Asha Rao");
}

/** A status change's assignee is named too. */
export async function theStatusChangeAssigneeIsNamed(): Promise<void> {
  const body = { status: "assigned", assignedTo: USER };
  expect((await resolveAs("workOrder.setStatus", "admin", null, { body }))?.refName).toBe("Asha Rao");
}

/** An assignee the change's organization does not hold (another organization's, or a global admin) is refused. */
export async function anAssigneeOutsideTheOrganizationIsRefused(): Promise<void> {
  const body = { assetId: ASSET, title: "Check the breaker", assignedTo: USER };
  expect(await resolveAs("workOrder.create", "admin", null, { body, world: { refFound: false } })).toBeNull();
}
