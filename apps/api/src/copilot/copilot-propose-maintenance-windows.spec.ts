import { expect } from "vitest";

import type { JwtPayload, UserRole } from "@bms/shared";
import { catalogEntry, hashExcludedKeysOf } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import { canPerformOperationsWrite, type OperationsWriteClass } from "../auth/operations-write";
import { validateExtension } from "../maintenance-windows/maintenance-window-period";
import { CANCEL_NOT_FUTURE, END_NOT_ACTIVE, EXTEND_NOT_ACTIVE } from "../maintenance-windows/maintenance-windows.service";
import { bodyHash } from "./body-hash";
import {
  type LabelledWindowTarget,
  type MaintenanceWindowReads,
  resolveMaintenanceWindowTarget,
  type StoredWindow,
} from "./copilot-maintenance-window-targets";
import {
  PROPOSE_MAINTENANCE_WINDOW_NOT_ASKED_ERROR,
  PROPOSE_MAINTENANCE_WINDOW_ON_FOLLOW_UP_ERROR,
} from "./copilot-maintenance-window-intent";
import { CopilotTargetResolver, type ResolvedTarget } from "./copilot-target-resolver";
import { proposeHarness } from "./copilot-propose-tools.spec";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decisions 2, 4, 5, 7, 8; rulings Q2, Q4,
 * Q5, Q6, Q7) — the maintenance-window entries end to end at propose:
 *
 * - the `maintenanceWindow` target (`resolveMaintenanceWindowTarget`) with the
 *   real role rule and the routes' own scope check (`maintenance-window-scope.ts`)
 *   over a fake read of the rows;
 * - the propose tools over the real catalog entries: the own-message rule, the
 *   reason in the hash, and the route's own sentences for a window in the wrong
 *   state or a period the route refuses.
 *
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const USER = "11111111-1111-4111-8111-111111111111";
const WINDOW = "40000000-0000-4000-8000-000000000001";
const SITE_S = "50000000-0000-4000-8000-00000000000a";
const CHILD_C = "50000000-0000-4000-8000-00000000000c";
const ASSET_S = "30000000-0000-4000-8000-00000000000a";
const ASSET_C = "30000000-0000-4000-8000-00000000000c";
const ASSET_U = "30000000-0000-4000-8000-0000000000bb";

const asset = (id: string, organizationId: string, label: string): LabelledWindowTarget => ({ kind: "asset", id, organizationId, label });
const location = (id: string, organizationId: string, label: string): LabelledWindowTarget => ({
  kind: "location",
  id,
  organizationId,
  label,
});

/** Org A: site S with child C, an asset at each; org B: an asset U. */
const ROWS: readonly LabelledWindowTarget[] = [
  location(SITE_S, ORG_A, "Site S"),
  location(CHILD_C, ORG_A, "Child C"),
  asset(ASSET_S, ORG_A, "Chiller S"),
  asset(ASSET_C, ORG_A, "Chiller C"),
  asset(ASSET_U, ORG_B, "Pump U"),
];

function window(targets: readonly LabelledWindowTarget[], state: StoredWindow["state"] = "active"): StoredWindow {
  return {
    id: WINDOW,
    organizationId: ORG_A,
    reason: "Chiller overhaul",
    startsAt: "2026-10-11T05:00:00.000Z",
    endsAt: "2026-10-11T09:00:00.000Z",
    state,
    targets,
  };
}

/** The rows of each organization, read by id; `asked` records every read. */
function fakeReads(stored: StoredWindow | null, asked: string[] = []): MaintenanceWindowReads {
  return {
    targetsIn: async (organizationId, input) => {
      asked.push(`targets:${organizationId}`);
      const ids = input.map((t) => (t.kind === "asset" ? t.assetId : t.kind === "location" ? t.locationId : t.ruleId));
      return ROWS.filter((row) => row.organizationId === organizationId && ids.includes(row.id));
    },
    coveredAssetCount: async (_organizationId, locationIds) => (locationIds.includes(SITE_S) ? 2 : 1),
    windowIn: async (organizationId, id) => (stored !== null && stored.organizationId === organizationId && stored.id === id ? stored : null),
  };
}

type Grant = { kind: "global" | "location" | "asset_group"; assetIds: string[]; locationIds: string[] };

const ADMIN_GRANT: Grant = { kind: "global", assetIds: [], locationIds: [] };
/** A location admin of S: S, C and both assets. */
const SITE_ADMIN_OF_S: Grant = { kind: "location", assetIds: [ASSET_S, ASSET_C], locationIds: [SITE_S, CHILD_C] };
/** A location admin of C alone. */
const SITE_ADMIN_OF_C: Grant = { kind: "location", assetIds: [ASSET_C], locationIds: [CHILD_C] };
/** An asset-group admin of a group at S: its member asset, and S named as the group's location. */
const GROUP_ADMIN_AT_S: Grant = { kind: "asset_group", assetIds: [ASSET_S], locationIds: [SITE_S] };

/** `AccessControlService` as the window routes call it, with the real role rule; `asked` records the order. */
function windowAccess(grant: Grant, asked: string[] = []): never {
  return {
    assertOperationsWriteRole: async (user: JwtPayload, writeClass: OperationsWriteClass) => {
      asked.push(`role:${writeClass}`);
      if (!canPerformOperationsWrite(user.role as UserRole, writeClass)) throw new Error("403");
    },
    isGlobalAdmin: async (user: JwtPayload) => {
      asked.push("scope");
      return user.role === "admin";
    },
    currentUser: async () => ({
      scope: { kind: grant.kind, assetIds: grant.assetIds, assetGroups: [], locations: grant.locationIds.map((id) => ({ id })) },
    }),
    readableOrganizationIds: async () => [ORG_A],
  } as never;
}

const user = (role: string) => ({ sub: USER, role }) as JwtPayload;
const CREATE_TARGET = { kind: "maintenanceWindow", field: "targets" } as const;
const ROW_TARGET = { kind: "maintenanceWindow", param: "id" } as const;
const createBody = (...targets: Array<Record<string, string>>) => ({ reason: "Chiller overhaul", endsAt: "2026-10-11T09:00:00.000Z", targets });

async function create(role: string, grant: Grant, body: Record<string, unknown>, options: { asked?: string[]; allowed?: string[] } = {}) {
  return resolveMaintenanceWindowTarget(
    fakeReads(null, options.asked),
    windowAccess(grant, options.asked),
    user(role),
    CREATE_TARGET,
    {},
    body,
    options.allowed ?? [ORG_A, ORG_B],
  );
}

async function onRow(role: string, grant: Grant, stored: StoredWindow) {
  return resolveMaintenanceWindowTarget(fakeReads(stored), windowAccess(grant), user(role), ROW_TARGET, { id: WINDOW }, {}, [ORG_A, ORG_B]);
}

// --- the target: role and scope (decisions 2 and 7) ---------------------------------------------------

/** Q6: each copilot role with the asset in its read scope resolves a create, asked the role class first, then the scope. */
export async function everyCopilotRoleInScopeResolvesACreate(): Promise<void> {
  for (const [role, grant] of [
    ["admin", ADMIN_GRANT],
    ["organization_admin", SITE_ADMIN_OF_S],
    ["location_admin", SITE_ADMIN_OF_S],
    ["asset_group_admin", GROUP_ADMIN_AT_S],
  ] as const) {
    const asked: string[] = [];
    const found = await create(role, grant, createBody({ kind: "asset", assetId: ASSET_S }), { asked });
    expect(found?.organizationId, role).toBe(ORG_A);
    expect(asked.slice(0, 2), role).toEqual(["role:configuration", "scope"]);
  }
}

/** The route's role gate first: an operator and a viewer are refused before any scope or row is read. */
export async function anOperatorAndAViewerAreRefusedBeforeTheScope(): Promise<void> {
  for (const role of ["operator", "viewer"]) {
    const asked: string[] = [];
    expect(await create(role, ADMIN_GRANT, createBody({ kind: "asset", assetId: ASSET_S }), { asked }), role).toBeNull();
    expect(asked, role).toEqual(["role:configuration"]);
  }
}

/** The route's location rule: a location above the caller's grant is refused, though it reads an asset under it. */
export async function aLocationOutsideTheGrantIsRefused(): Promise<void> {
  expect(await create("location_admin", SITE_ADMIN_OF_C, createBody({ kind: "location", locationId: SITE_S }))).toBeNull();
  expect((await create("location_admin", SITE_ADMIN_OF_C, createBody({ kind: "location", locationId: CHILD_C })))?.organizationId).toBe(ORG_A);
}

/** An asset-group admin names no location, not even its group's; its member asset it may name. */
export async function anAssetGroupAdminCannotNameALocation(): Promise<void> {
  expect(await create("asset_group_admin", GROUP_ADMIN_AT_S, createBody({ kind: "location", locationId: SITE_S }))).toBeNull();
  expect((await create("asset_group_admin", GROUP_ADMIN_AT_S, createBody({ kind: "asset", assetId: ASSET_S })))?.organizationId).toBe(ORG_A);
}

/** Targets of two organizations are refused, as the route refuses them, and so is a target that exists nowhere. */
export async function targetsOfTwoOrganizationsAreRefused(): Promise<void> {
  expect(await create("admin", ADMIN_GRANT, createBody({ kind: "asset", assetId: ASSET_S }, { kind: "asset", assetId: ASSET_U }))).toBeNull();
  const missing = { kind: "asset", assetId: "30000000-0000-4000-8000-0000000000ff" };
  expect(await create("admin", ADMIN_GRANT, createBody({ kind: "asset", assetId: ASSET_S }, missing))).toBeNull();
  // Only the allowed organizations are read: B alone holds one of the two.
  expect(await create("admin", ADMIN_GRANT, createBody({ kind: "asset", assetId: ASSET_U }), { allowed: [ORG_A] })).toBeNull();
}

/** Decision 3 (Q5): the card data names every target in the body's order, the location and the assets it covers. */
export async function aCreateCarriesTheLabelsAndTheCoveredCount(): Promise<void> {
  const found = await create("admin", ADMIN_GRANT, {
    ...createBody({ kind: "asset", assetId: ASSET_C }, { kind: "location", locationId: SITE_S }),
    startsAt: "2026-10-11T07:00:00.000Z",
  });
  expect(found?.maintenanceWindow).toEqual({
    reason: "Chiller overhaul",
    startsAt: "2026-10-11T07:00:00.000Z",
    endsAt: "2026-10-11T09:00:00.000Z",
    targetLabels: ["Chiller C", "Site S"],
    locationLabels: ["Site S"],
    coveredAssetCount: 2,
    state: null,
  });
}

/** D15 at propose: a window with any target outside the caller's scope is refused; one inside resolves by its reason. */
export async function aWindowWithATargetOutsideTheScopeIsRefused(): Promise<void> {
  const both = window([asset(ASSET_S, ORG_A, "Chiller S"), asset(ASSET_C, ORG_A, "Chiller C")]);
  expect(await onRow("location_admin", SITE_ADMIN_OF_C, both)).toBeNull();
  const found = await onRow("location_admin", SITE_ADMIN_OF_S, both);
  expect([found?.organizationId, found?.name, found?.maintenanceWindow.state]).toEqual([ORG_A, "Chiller overhaul", "active"]);
  expect(await onRow("operator", ADMIN_GRANT, both)).toBeNull();
}

/** Decision 1: a window is named by its reason, cut at 80 characters. */
export async function aLongReasonIsCutAt80(): Promise<void> {
  const long = { ...window([asset(ASSET_C, ORG_A, "Chiller C")]), reason: "x".repeat(120) };
  const found = await onRow("admin", ADMIN_GRANT, long);
  expect(found?.name).toBe(`${"x".repeat(80)}...`);
  expect(found?.maintenanceWindow.reason).toBe("x".repeat(120));
}

/** The resolver's branch is wired: an operator is refused through `CopilotTargetResolver` before any database read. */
export async function theResolverRefusesAnOperatorThroughTheBranch(): Promise<void> {
  const asked: string[] = [];
  const resolver = new CopilotTargetResolver({} as never, windowAccess(ADMIN_GRANT, asked), {} as never, {} as never);
  const entry = catalogEntry("maintenanceWindow.end")!;
  expect(await resolver.resolve(entry, { id: WINDOW }, {}, [ORG_A], user("operator"), ORG_A)).toBeNull();
  expect(asked).toEqual(["role:configuration"]);
}

// --- the propose tools: the own-message rule (decision 4, Q2) ----------------------------------------

const CARD = {
  reason: "Chiller overhaul",
  startsAt: "2026-10-11T05:00:00.000Z",
  endsAt: "2026-10-11T09:00:00.000Z",
  targetLabels: ["Chiller C"],
  locationLabels: [],
  coveredAssetCount: 0,
};
const targetIn = (state: "active" | "future" | "past" | null): ResolvedTarget => ({
  organizationId: ORG_A,
  organizationName: "Org A",
  targetName: "Chiller overhaul",
  maintenanceWindow: { ...CARD, state },
});
const ASK = (...ids: string[]) => ({ operationalIntent: ids });
/** The harness's clock is 2026-10-11T06:00:00Z: the active window ends at 09:00. */
const CREATE_BODY = { reason: "Chiller overhaul", endsAt: "2026-10-11T09:00:00.000Z", targets: [{ kind: "asset", assetId: ASSET_C }] };
const EXTEND_BODY = { endsAt: "2026-10-11T12:00:00.000Z", reason: "Parts late" };

/** A create or an extend in an automatic follow-up turn is refused, even with the words; the end is not. */
export async function aFollowUpTurnRefusesTheCreateAndTheExtendNotTheEnd(): Promise<void> {
  const h = proposeHarness({ target: targetIn("active") });
  const followUp = { turnKind: "follow_up" as const, operationalIntent: ["maintenanceWindow.create", "maintenanceWindow.extend"] };
  expect((await h.call("propose_maintenanceWindow_create", { body: CREATE_BODY }, followUp)).content).toBe(PROPOSE_MAINTENANCE_WINDOW_ON_FOLLOW_UP_ERROR);
  expect((await h.call("propose_maintenanceWindow_extend", { id: WINDOW, body: EXTEND_BODY }, followUp)).content).toBe(
    PROPOSE_MAINTENANCE_WINDOW_ON_FOLLOW_UP_ERROR,
  );
  const end = await h.call("propose_maintenanceWindow_end", { id: WINDOW, body: {} }, { turnKind: "follow_up" });
  expect(end.ok, end.content).toBe(true);
}

/** A user turn whose message had no create or extend word: both refuse; the end and the cancel need no word. */
export async function noIntentWordRefusesTheCreateAndTheExtend(): Promise<void> {
  const h = proposeHarness({ target: targetIn("active") });
  expect((await h.call("propose_maintenanceWindow_create", { body: CREATE_BODY })).content).toBe(PROPOSE_MAINTENANCE_WINDOW_NOT_ASKED_ERROR);
  // An extend word does not allow a create, nor the other way round.
  expect((await h.call("propose_maintenanceWindow_create", { body: CREATE_BODY }, ASK("maintenanceWindow.extend"))).content).toBe(
    PROPOSE_MAINTENANCE_WINDOW_NOT_ASKED_ERROR,
  );
  expect((await h.call("propose_maintenanceWindow_extend", { id: WINDOW, body: EXTEND_BODY }, ASK("maintenanceWindow.create"))).content).toBe(
    PROPOSE_MAINTENANCE_WINDOW_NOT_ASKED_ERROR,
  );
  expect((await h.call("propose_maintenanceWindow_end", { id: WINDOW, body: {} })).ok).toBe(true);
  expect(h.stored.map((change) => change.catalogId)).toEqual(["maintenanceWindow.end"]);
}

/** The registry withholds the create and the extend unless asked, each by its own id; end and cancel stay, for every copilot role (Q6). */
export async function theRegistryWithholdsTheGatedToolsUnlessAsked(): Promise<void> {
  const h = proposeHarness();
  for (const role of ["admin", "organization_admin", "location_admin", "asset_group_admin"]) {
    const names = (operational: string[]) => h.tools.registryFor({ access: false, role, operational }).definitions.map((d) => d.name);
    expect(names([]), role).toEqual(expect.arrayContaining(["propose_maintenanceWindow_end", "propose_maintenanceWindow_cancel"]));
    expect(names([]), role).not.toContain("propose_maintenanceWindow_create");
    expect(names([]), role).not.toContain("propose_maintenanceWindow_extend");
    expect(names(["maintenanceWindow.create"]), role).toContain("propose_maintenanceWindow_create");
    expect(names(["maintenanceWindow.create"]), role).not.toContain("propose_maintenanceWindow_extend");
  }
}

/** `fill_step` cannot pre-fill a create wizard from a turn that did not ask either. */
export async function fillStepRefusesAnUnaskedCreate(): Promise<void> {
  const h = proposeHarness({ target: targetIn(null) });
  const out = await h.tools.dispatch(
    "fill_step",
    { catalogId: "maintenanceWindow.create", params: {}, stepId: "window", values: { reason: "Chiller overhaul" } },
    h.ctx(),
  );
  expect(out).toEqual({ ok: false, error: PROPOSE_MAINTENANCE_WINDOW_NOT_ASKED_ERROR });
}

// --- the reason in the hash (decision 5, Q7) -----------------------------------------------------------

/** The stored hash binds the model's reason: the card's body changed at Confirm (another reason) hashes differently, a 409. */
export async function theReasonIsInTheHash(): Promise<void> {
  const h = proposeHarness({ target: targetIn(null) });
  const outcome = await h.call("propose_maintenanceWindow_create", { body: CREATE_BODY }, ASK("maintenanceWindow.create"));
  expect(outcome.ok, outcome.content).toBe(true);
  const entry = catalogEntry("maintenanceWindow.create")!;
  expect(hashExcludedKeysOf(entry)).toEqual([]);
  expect(h.stored[0]?.bodyHash).toBe(bodyHash(CREATE_BODY, []));
  expect(h.stored[0]?.bodyHash).not.toBe(bodyHash({ ...CREATE_BODY, reason: "Something else" }, []));
  expect([h.stored[0]?.risk, h.stored[0]?.path]).toEqual(["create", "/api/v1/maintenance-windows"]);
  expect(h.stored[0]?.summary).toContain('Reason: "Chiller overhaul".');
}

// --- the route's own refusals at propose (decision 8) ---------------------------------------------------

/** An extend of a window that is not active is refused with the route's sentence; nothing is stored. */
export async function anExtendOfAPastWindowIsRefusedWithTheRoutesSentence(): Promise<void> {
  for (const state of ["past", "future"] as const) {
    const h = proposeHarness({ target: targetIn(state) });
    const out = await h.call("propose_maintenanceWindow_extend", { id: WINDOW, body: EXTEND_BODY }, ASK("maintenanceWindow.extend"));
    expect([out.ok, out.content], state).toEqual([false, EXTEND_NOT_ACTIVE]);
    expect(h.stored).toEqual([]);
  }
}

/** An end of a window that is not active, and a cancel of one that is not future, are refused with the routes' sentences. */
export async function anEndAndACancelInTheWrongStateAreRefused(): Promise<void> {
  const ended = proposeHarness({ target: targetIn("future") });
  expect((await ended.call("propose_maintenanceWindow_end", { id: WINDOW, body: {} })).content).toBe(END_NOT_ACTIVE);
  const cancelled = proposeHarness({ target: targetIn("active") });
  expect((await cancelled.call("propose_maintenanceWindow_cancel", { id: WINDOW, body: {} })).content).toBe(CANCEL_NOT_FUTURE);
  const future = proposeHarness({ target: targetIn("future") });
  expect((await future.call("propose_maintenanceWindow_cancel", { id: WINDOW, body: {} })).ok).toBe(true);
}

/** A period the route refuses is refused with its sentence: an extend past now + 7 days, a create longer than 7 days. */
export async function aPeriodTheRouteRefusesIsRefused(): Promise<void> {
  const h = proposeHarness({ target: targetIn("active") });
  const far = { endsAt: "2026-10-19T06:00:00.000Z" };
  const expected = validateExtension({ now: new Date("2026-10-11T06:00:00Z"), endsAt: new Date(far.endsAt), currentEndsAt: new Date(CARD.endsAt) });
  expect(expected).not.toBeNull();
  expect((await h.call("propose_maintenanceWindow_extend", { id: WINDOW, body: far }, ASK("maintenanceWindow.extend"))).content).toBe(expected);
  const created = proposeHarness({ target: targetIn(null) });
  const long = { ...CREATE_BODY, endsAt: "2026-10-19T06:00:00.000Z" };
  expect((await created.call("propose_maintenanceWindow_create", { body: long }, ASK("maintenanceWindow.create"))).content).toBe(
    "A maintenance window may run at most 7 days",
  );
  expect([h.stored, created.stored]).toEqual([[], []]);
}

/** A row entry whose target carries no window (a resolver that read none) fails closed. */
export async function aRowTargetWithoutAWindowFailsClosed(): Promise<void> {
  const h = proposeHarness({ target: { organizationId: ORG_A, organizationName: "Org A", targetName: "Chiller overhaul" } });
  expect((await h.call("propose_maintenanceWindow_end", { id: WINDOW, body: {} })).ok).toBe(false);
  expect(h.stored).toEqual([]);
}

/** Q6: an asset-group admin's dispatch is admitted (the route's own gate decides at Confirm). */
export async function anAssetGroupAdminIsAdmitted(): Promise<void> {
  const h = proposeHarness({ target: targetIn("active") });
  const identity = { id: USER, role: "asset_group_admin", organizationId: ORG_A } as ResolvedIdentity;
  const out = await h.tools.dispatch("propose_maintenanceWindow_end", { id: WINDOW, body: {} }, h.ctx({ identity }));
  expect(out.ok).toBe(true);
}
