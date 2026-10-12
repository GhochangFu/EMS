import { expect } from "vitest";
import { z } from "zod";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";
import type { CatalogEntry, CatalogRef, CatalogTarget } from "@bms/shared/copilot";

import { NO_GRANTS, NO_USERS } from "../testing/copilot-user-checks";
import { CopilotTargetResolver, refKindOf } from "./copilot-target-resolver";

/**
 * `F3.86` PR 2 / ADR 0099 decision 10 (plan §4.2) — the resolver's release-2
 * target kinds on a real database, as `bms_tenant`: each row is found only in
 * an allowed organization, under its tenant policy, and each kind runs the
 * check of the route it mirrors, on the right row.
 *
 * The access service is a recorder: it answers from a table and keeps every
 * call with its arguments, so an assertion names the row a check ran on (a
 * swapped argument keeps a "was it called" assertion green). Each forbidden
 * case sits beside its allowed twin, so "return `true` without calling the
 * check" turns the forbidden one red. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */
export type ResolverCtx = {
  tenantDb: BmsDb;
  orgA: string;
  orgB: string;
  locationA: string;
  /** A second site of A with no Control Room view row. */
  locationA2: string;
  locationB: string;
  rtuA: string;
  assetA: string;
  groupA: string;
  memberA: string;
  assetPointA: string;
  /** An existing point-key row and its code (the catalog is fleet-wide). */
  pointKeyId: string;
  pointKeyCode: string;
  dashboardA: string;
  dashboardTemplateA: string;
};

/** `locationA` carries a stored `builtin` view (`site_control_room_views`); `locationA2` carries none. */
export const RESOLVER_NAMES = {
  orgA: "F3.86 resolver A",
  locationA: "F3.86 site A",
  rtuA: "F3.86 RTU A",
  assetA: "F3.86 asset A",
  groupA: "F3.86 group A",
} as const;

type Call = [string, ...unknown[]];

/** An access service that answers from `answers` (default `true`) and records each call. */
function recorder(answers: Partial<Record<string, boolean>> = {}, role: UserRole = "admin") {
  const calls: Call[] = [];
  const answer = (name: string, ...args: unknown[]) => {
    calls.push([name, ...args]);
    return Promise.resolve(answers[name] ?? true);
  };
  const access = {
    requireMasterDataUser: async () => {
      calls.push(["requireMasterDataUser"]);
      return { id: "u", email: "u@example.test", displayName: "U", role };
    },
    canManageLocation: (_user: JwtPayload, locationId: string) => answer("canManageLocation", locationId),
    canManageAsset: (_user: JwtPayload, assetId: string) => answer("canManageAsset", assetId),
    canManageOrganization: (_user: JwtPayload, organizationId: string) => answer("canManageOrganization", organizationId),
    canManageDashboard: (_user: JwtPayload, organizationId: string, scope: unknown) =>
      answer("canManageDashboard", organizationId, scope),
    canManageTemplate: (_user: JwtPayload, organizationId: string) => answer("canManageTemplate", organizationId),
    isGlobalAdmin: () => answer("isGlobalAdmin"),
  };
  return { calls, access: access as never };
}

const JWT = { sub: "f386-resolver" } as JwtPayload;

/** A catalog entry with only what the resolver reads: its target and refs. */
function fixture(target: CatalogTarget, refs: readonly CatalogRef[] = []): CatalogEntry {
  return {
    id: "fixture.resolver",
    title: "Fixture",
    method: "POST",
    path: "/fixtures",
    params: {},
    body: z.object({}).strict(),
    bodyName: null,
    clientOnly: [],
    risk: "edit",
    target,
    refs,
    formulas: [],
    steps: [],
    summary: () => "fixture",
  };
}

const resolverWith = (ctx: ResolverCtx, access: never) => new CopilotTargetResolver(ctx.tenantDb, access, NO_USERS, NO_GRANTS);

/** `location`: found in its organization only; the route's `canManageLocation` on that site. */
export async function aLocationResolvesWithItsSiteCheck(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "location", param: "id" });
  const allowed = recorder();
  expect(await resolverWith(ctx, allowed.access).resolve(entry, { id: ctx.locationA }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.locationA,
    organizationName: RESOLVER_NAMES.orgA,
  });
  expect(allowed.calls).toContainEqual(["canManageLocation", ctx.locationA]);
  expect(await resolverWith(ctx, recorder().access).resolve(entry, { id: ctx.locationA }, {}, [ctx.orgB], JWT)).toBeNull();
  const denied = recorder({ canManageLocation: false });
  expect(await resolverWith(ctx, denied.access).resolve(entry, { id: ctx.locationA }, {}, [ctx.orgA], JWT)).toBeNull();
  expect(denied.calls).toContainEqual(["canManageLocation", ctx.locationA]);
}

/** `rtu`, `assetGroup`, `assetGroupMember`: the row's own site is the one checked, not the id in the path. */
export async function aSiteRowIsCheckedOnItsOwnSite(ctx: ResolverCtx): Promise<void> {
  const cases: Array<[CatalogTarget["kind"], string, string]> = [
    ["rtu", ctx.rtuA, RESOLVER_NAMES.rtuA],
    ["assetGroup", ctx.groupA, RESOLVER_NAMES.groupA],
    ["assetGroupMember", ctx.memberA, `${RESOLVER_NAMES.assetA} in ${RESOLVER_NAMES.groupA}`],
  ];
  for (const [kind, id, name] of cases) {
    const entry = fixture({ kind, param: "id" } as CatalogTarget);
    const allowed = recorder();
    expect(await resolverWith(ctx, allowed.access).resolve(entry, { id }, {}, [ctx.orgA], JWT), kind).toMatchObject({
      organizationId: ctx.orgA,
      targetName: name,
    });
    expect(allowed.calls, kind).toEqual([["requireMasterDataUser"], ["canManageLocation", ctx.locationA]]);
    const denied = recorder({ canManageLocation: false });
    expect(await resolverWith(ctx, denied.access).resolve(entry, { id }, {}, [ctx.orgA], JWT), kind).toBeNull();
    expect(await resolverWith(ctx, recorder().access).resolve(entry, { id }, {}, [ctx.orgB], JWT), kind).toBeNull();
  }
}

/** `assetPoint` checks the asset it maps; `asset` by `:id` checks itself. */
export async function anAssetRowIsCheckedOnItsAsset(ctx: ResolverCtx): Promise<void> {
  const point = fixture({ kind: "assetPoint", param: "id" });
  const allowed = recorder();
  expect(await resolverWith(ctx, allowed.access).resolve(point, { id: ctx.assetPointA }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: ctx.pointKeyCode,
  });
  expect(allowed.calls).toEqual([["canManageAsset", ctx.assetA]]);
  expect(await resolverWith(ctx, recorder({ canManageAsset: false }).access).resolve(point, { id: ctx.assetPointA }, {}, [ctx.orgA], JWT)).toBeNull();

  const asset = fixture({ kind: "asset", param: "id" });
  const byId = recorder();
  expect(await resolverWith(ctx, byId.access).resolve(asset, { id: ctx.assetA }, {}, [ctx.orgA], JWT)).toMatchObject({
    targetName: RESOLVER_NAMES.assetA,
  });
  expect(byId.calls).toEqual([["canManageAsset", ctx.assetA]]);
}

/** `parent`: a create's organization is the row the body names, checked by the route's own rule; another organization's row is `null`. */
export async function aCreateUnderAParentTakesTheParentsOrganization(ctx: ResolverCtx): Promise<void> {
  const underSite = fixture({ kind: "parent", field: "locationId", of: "location" });
  const allowed = recorder();
  expect(await resolverWith(ctx, allowed.access).resolve(underSite, {}, { locationId: ctx.locationA }, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.locationA,
  });
  expect(allowed.calls).toContainEqual(["canManageLocation", ctx.locationA]);
  expect(await resolverWith(ctx, recorder().access).resolve(underSite, {}, { locationId: ctx.locationB }, [ctx.orgA], JWT)).toBeNull();
  expect(await resolverWith(ctx, recorder().access).resolve(underSite, {}, {}, [ctx.orgA], JWT)).toBeNull();
  const denied = recorder({ canManageLocation: false });
  expect(await resolverWith(ctx, denied.access).resolve(underSite, {}, { locationId: ctx.locationA }, [ctx.orgA], JWT)).toBeNull();

  const underAsset = fixture({ kind: "parent", field: "assetId", of: "asset" });
  const onAsset = recorder();
  expect(await resolverWith(ctx, onAsset.access).resolve(underAsset, {}, { assetId: ctx.assetA }, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
  });
  expect(onAsset.calls).toEqual([["canManageAsset", ctx.assetA]]);
  expect(await resolverWith(ctx, recorder({ canManageAsset: false }).access).resolve(underAsset, {}, { assetId: ctx.assetA }, [ctx.orgA], JWT)).toBeNull();
}

/** Ruling Q1: a fleet row lives in the bound organization, and only a global admin may change it. */
export async function aFleetRowLivesInTheBoundOrganization(ctx: ResolverCtx): Promise<void> {
  const create = fixture({ kind: "fleet" });
  const update = fixture({ kind: "pointKey", param: "id" });
  const r = resolverWith(ctx, recorder().access);
  expect(await r.resolve(create, {}, {}, [ctx.orgA, ctx.orgB], JWT, null)).toBeNull();
  expect(await r.resolve(create, {}, {}, [ctx.orgA], JWT, ctx.orgB)).toBeNull();
  expect(await r.resolve(create, {}, {}, [ctx.orgA, ctx.orgB], JWT, ctx.orgA)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.orgA,
  });
  expect(await r.resolve(update, { id: ctx.pointKeyId }, {}, [ctx.orgA], JWT, ctx.orgA)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: ctx.pointKeyCode,
  });
  expect(await r.resolve(update, { id: ctx.pointKeyId }, {}, [ctx.orgA], JWT, null)).toBeNull();
  const notGlobal = recorder({ isGlobalAdmin: false });
  expect(await resolverWith(ctx, notGlobal.access).resolve(update, { id: ctx.pointKeyId }, {}, [ctx.orgA], JWT, ctx.orgA)).toBeNull();
  expect(notGlobal.calls).toEqual([["requireMasterDataUser"], ["isGlobalAdmin"]]);
}

/**
 * Ruling Q7(b), `putSetting`'s rule: a built-in view is the global admin's —
 * set (the body) or replaced (the stored row). Each refusal beside the twin
 * that passes.
 */
export async function aSiteViewKeepsTheBuiltinRule(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "siteControlRoomView", param: "id" });
  const as = (role: UserRole) => resolverWith(ctx, recorder({}, role).access);
  const builtin = { kind: "builtin", builtinKey: "smoc" };
  const generated = { kind: "generated" };
  // locationA2 has no stored view: the body alone decides.
  expect(await as("location_admin").resolve(entry, { id: ctx.locationA2 }, builtin, [ctx.orgA], JWT)).toBeNull();
  expect(await as("admin").resolve(entry, { id: ctx.locationA2 }, builtin, [ctx.orgA], JWT)).toMatchObject({ organizationId: ctx.orgA });
  expect(await as("location_admin").resolve(entry, { id: ctx.locationA2 }, generated, [ctx.orgA], JWT)).not.toBeNull();
  // locationA stores a built-in view: only the global admin replaces it.
  expect(await as("location_admin").resolve(entry, { id: ctx.locationA }, generated, [ctx.orgA], JWT)).toBeNull();
  expect(await as("admin").resolve(entry, { id: ctx.locationA }, generated, [ctx.orgA], JWT)).toMatchObject({
    targetName: RESOLVER_NAMES.locationA,
  });
  expect(await resolverWith(ctx, recorder({ canManageLocation: false }).access).resolve(entry, { id: ctx.locationA2 }, generated, [ctx.orgA], JWT)).toBeNull();
}

/** Ruling Q7(b), `makeForSite`'s checks: the site, then a dashboard on the site's scope. */
export async function aSiteLayoutNeedsTheDashboardCheckToo(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "siteLayout", param: "id" });
  const both = recorder();
  expect(await resolverWith(ctx, both.access).resolve(entry, { id: ctx.locationA }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.locationA,
  });
  expect(both.calls).toEqual([
    ["requireMasterDataUser"],
    ["canManageLocation", ctx.locationA],
    ["canManageDashboard", ctx.orgA, { locationId: ctx.locationA, assetGroupId: null, assetId: null }],
  ]);
  const noDashboard = recorder({ canManageDashboard: false });
  expect(await resolverWith(ctx, noDashboard.access).resolve(entry, { id: ctx.locationA }, {}, [ctx.orgA], JWT)).toBeNull();
}

/** A location create: never a `location_admin`, and the organization's own check. */
export async function aLocationCreateRefusesALocationAdmin(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "organization", manage: "location" });
  const body = { organizationId: ctx.orgA };
  expect(await resolverWith(ctx, recorder({}, "location_admin").access).resolve(entry, {}, body, [ctx.orgA], JWT)).toBeNull();
  const orgAdmin = recorder({}, "organization_admin");
  expect(await resolverWith(ctx, orgAdmin.access).resolve(entry, {}, body, [ctx.orgA], JWT)).toMatchObject({ organizationId: ctx.orgA });
  expect(orgAdmin.calls).toContainEqual(["canManageOrganization", ctx.orgA]);
  expect(await resolverWith(ctx, recorder({ canManageOrganization: false }, "organization_admin").access).resolve(entry, {}, body, [ctx.orgA], JWT)).toBeNull();
}

/** The new ref kinds: each must be a row of the change's organization; an organization ref must be that organization. */
export async function theNewRefKindsBelongToTheOrganization(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  const at = (refs: CatalogRef[], body: Record<string, unknown>) =>
    r.resolve(fixture({ kind: "location", param: "id" }, refs), { id: ctx.locationA }, body, [ctx.orgA, ctx.orgB], JWT);
  for (const [kind, id] of [
    ["rtu", ctx.rtuA],
    ["organization", ctx.orgA],
    ["dashboard", ctx.dashboardA],
    ["dashboardTemplate", ctx.dashboardTemplateA],
  ] as const) {
    expect(await at([{ field: "ref", kind }], { ref: id }), kind).not.toBeNull();
  }
  expect(await at([{ field: "ref", kind: "organization" }], { ref: ctx.orgB })).toBeNull();
  expect(await at([{ field: "ref", kind: "rtu" }], { ref: ctx.locationB })).toBeNull();
  // The dynamic form: the kind comes from another field; a value the map lacks is refused.
  const grant: CatalogRef = { field: "targetId", kindField: "kind", kinds: { location: "location", organization: "organization" } };
  expect(await at([grant], { kind: "location", targetId: ctx.locationA })).not.toBeNull();
  expect(await at([grant], { kind: "location", targetId: ctx.locationB })).toBeNull();
  expect(await at([grant], { kind: "asset_group", targetId: ctx.groupA })).toBeNull();
}

/** `refKindOf` without a database: a fixed kind, a mapped kind, and an unmapped or non-string value. */
export function refKindOfReadsTheKindField(): void {
  const grant: CatalogRef = { field: "targetId", kindField: "kind", kinds: { asset_group: "assetGroup" } };
  expect(refKindOf({ field: "locationId", kind: "location" }, {})).toBe("location");
  expect(refKindOf(grant, { kind: "asset_group" })).toBe("assetGroup");
  expect(refKindOf(grant, { kind: "location" })).toBeNull();
  expect(refKindOf(grant, { kind: 7 })).toBeNull();
  expect(refKindOf(grant, { kind: "__proto__" })).toBeNull();
}

// --- F3.86 PR 4: the user targets, through the users services (called, never copied) ---

/** Recording fakes of `UsersService` and `UserGrantsService`'s checks; `throws` names the ones that refuse. */
function userServices(
  ctx: ResolverCtx,
  over: { throws?: string[]; homeOrganization?: string | null; managerRole?: string; writable?: string[] | null; grantOrganization?: string } = {},
) {
  const calls: Call[] = [];
  const step = <T>(name: string, value: T, ...args: unknown[]): Promise<T> => {
    calls.push([name, ...args]);
    return over.throws?.includes(name) ? Promise.reject(new Error(`403 from ${name}`)) : Promise.resolve(value);
  };
  const manager = { role: over.managerRole ?? "admin", writable: over.writable ?? null };
  const row = { id: "user-1", displayName: "Priya Rao", organizationId: over.homeOrganization === undefined ? ctx.orgA : over.homeOrganization };
  const users = {
    requireManager: () => step("requireManager", manager),
    requireManageableTarget: (_m: unknown, id: string) => step("requireManageableTarget", row, id),
  };
  const grants = {
    assertGrantAddable: (_j: unknown, _m: unknown, _u: unknown, body: unknown) =>
      step("assertGrantAddable", { organizationId: over.grantOrganization ?? ctx.orgA, targetId: "t", targetName: RESOLVER_NAMES.locationA }, body),
    assertGrantRemovable: (_j: unknown, _m: unknown, _u: unknown, kind: string, grantId: string) =>
      step("assertGrantRemovable", { organizationId: ctx.orgA, targetId: "t", targetName: RESOLVER_NAMES.groupA }, kind, grantId),
  };
  return { calls, users: users as never, grants: grants as never };
}

const withUsers = (ctx: ResolverCtx, s: ReturnType<typeof userServices>) =>
  new CopilotTargetResolver(ctx.tenantDb, recorder().access, s.users, s.grants);

/** `user`: the target's home organization, through `requireManager` then `requireManageableTarget`; any refusal is `null`. */
export async function aUserTargetUsesTheUsersServicesChecks(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "user", param: "id" });
  const ok = userServices(ctx);
  expect(await withUsers(ctx, ok).resolve(entry, { id: "user-1" }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: "Priya Rao",
  });
  expect(ok.calls).toEqual([["requireManager"], ["requireManageableTarget", "user-1"]]);
  expect(await withUsers(ctx, userServices(ctx, { throws: ["requireManageableTarget"] })).resolve(entry, { id: "user-1" }, {}, [ctx.orgA], JWT)).toBeNull();
  expect(await withUsers(ctx, userServices(ctx, { throws: ["requireManager"] })).resolve(entry, { id: "user-1" }, {}, [ctx.orgA], JWT)).toBeNull();
  // A global admin (no home organization) is never a target; a target outside the allowed set is the same refusal.
  expect(await withUsers(ctx, userServices(ctx, { homeOrganization: null })).resolve(entry, { id: "user-1" }, {}, [ctx.orgA], JWT)).toBeNull();
  expect(await withUsers(ctx, userServices(ctx)).resolve(entry, { id: "user-1" }, {}, [ctx.orgB], JWT)).toBeNull();
}

/** `userGrantAdd` and `userGrant`: the grant's organization and name, from the grants service's own asserts. */
export async function aGrantTargetUsesTheGrantsServicesChecks(ctx: ResolverCtx): Promise<void> {
  const add = fixture({ kind: "userGrantAdd", param: "id" });
  const ok = userServices(ctx);
  const body = { kind: "location", targetId: ctx.locationA };
  expect(await withUsers(ctx, ok).resolve(add, { id: "user-1" }, body, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: "Priya Rao",
    refName: RESOLVER_NAMES.locationA,
  });
  expect(ok.calls).toContainEqual(["assertGrantAddable", body]);
  expect(await withUsers(ctx, userServices(ctx, { throws: ["assertGrantAddable"] })).resolve(add, { id: "user-1" }, body, [ctx.orgA], JWT)).toBeNull();
  expect(await withUsers(ctx, userServices(ctx)).resolve(add, { id: "user-1" }, { kind: "nope", targetId: "x" }, [ctx.orgA], JWT)).toBeNull();

  const remove = fixture({ kind: "userGrant", param: "grantId", kindParam: "kind", userParam: "id" });
  const removing = userServices(ctx);
  const params = { id: "user-1", kind: "asset_group", grantId: "grant-9" };
  expect(await withUsers(ctx, removing).resolve(remove, params, {}, [ctx.orgA], JWT)).toMatchObject({ refName: RESOLVER_NAMES.groupA });
  expect(removing.calls).toContainEqual(["assertGrantRemovable", "asset_group", "grant-9"]);
  // The user is looked up by the user parameter, never by the grant id (code review).
  expect(removing.calls).toContainEqual(["requireManageableTarget", "user-1"]);
  expect(removing.calls).not.toContainEqual(["requireManageableTarget", "grant-9"]);
  expect(await withUsers(ctx, userServices(ctx, { throws: ["assertGrantRemovable"] })).resolve(remove, params, {}, [ctx.orgA], JWT)).toBeNull();
  expect(await withUsers(ctx, userServices(ctx)).resolve(remove, { ...params, kind: "site" }, {}, [ctx.orgA], JWT)).toBeNull();
}

/** A user create: a manager, a role it may give (`mayAssignRole`), an organization it may write. */
export async function aUserCreateRunsTheRoutesManagerChecks(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "organization", manage: "user" });
  const body = (role: string) => ({ organizationId: ctx.orgA, role });
  const orgAdmin = (writable: string[]) => userServices(ctx, { managerRole: "organization_admin", writable });
  expect(await withUsers(ctx, orgAdmin([ctx.orgA])).resolve(entry, {}, body("viewer"), [ctx.orgA], JWT)).toMatchObject({ organizationId: ctx.orgA });
  expect(await withUsers(ctx, orgAdmin([ctx.orgA])).resolve(entry, {}, body("admin"), [ctx.orgA], JWT)).toBeNull();
  expect(await withUsers(ctx, orgAdmin([ctx.orgB])).resolve(entry, {}, body("viewer"), [ctx.orgA], JWT)).toBeNull();
  expect(await withUsers(ctx, userServices(ctx, { throws: ["requireManager"] })).resolve(entry, {}, body("viewer"), [ctx.orgA], JWT)).toBeNull();
}

/**
 * A cross-organization grant (code review): the change lives in the grant
 * target's organization, not the user's home; and the user's home must be in
 * the turn's scope too (decision 10 — the user's name reaches the model).
 */
export async function aGrantLivesInItsTargetsOrganizationAndNeedsTheUsersHomeInScope(ctx: ResolverCtx): Promise<void> {
  const add = fixture({ kind: "userGrantAdd", param: "id" });
  const body = { kind: "location", targetId: ctx.locationB };
  const crossing = () => userServices(ctx, { grantOrganization: ctx.orgB });
  expect(await withUsers(ctx, crossing()).resolve(add, { id: "user-1" }, body, [ctx.orgA, ctx.orgB], JWT)).toMatchObject({
    organizationId: ctx.orgB,
  });
  // The user's home (A) outside the turn's scope: refused, though the grant target (B) is in it.
  expect(await withUsers(ctx, crossing()).resolve(add, { id: "user-1" }, body, [ctx.orgB], JWT)).toBeNull();
}
