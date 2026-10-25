import { expect } from "vitest";
import { z } from "zod";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";
import { type CatalogEntry, type CatalogRef, type CatalogTarget, catalogEntry } from "@bms/shared/copilot";

import { NO_GRANTS, NO_USERS } from "../testing/copilot-user-checks";
import { resolveWizardRecord, type WizardScope } from "./copilot-open-wizards";
import { CopilotTargetResolver, refKindOf } from "./copilot-target-resolver";
import { CopilotTargetRefusal } from "./copilot-telemetry-targets";

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
  /** `F4.254` PR 3: an RTU of B, on `locationB`. */
  rtuB: string;
  assetA: string;
  /** The asset's code: an asset-point card names `<code> <pointKey>`. */
  assetCodeA: string;
  groupA: string;
  memberA: string;
  assetPointA: string;
  /** An existing point-key row and its code (the catalog is fleet-wide). */
  pointKeyId: string;
  pointKeyCode: string;
  dashboardA: string;
  /** `F4.245`: dashboard A's slug, for the edit page an `open_page` call opens. */
  dashboardSlugA: string;
  dashboardTemplateA: string;
  /** `F4.254` PR 3: a published asset template of A (the instantiate route's template). */
  assetTemplateA: string;
  /** `F3.87` PR 5: a mimic layout of A (owed by PR 2: the `mimicLayout` kind on a real database). */
  mimicLayoutA: string;
  /** `F4.282`: a location type used by two locations of A and one of B, and a unit role. */
  locationTypeCode: string;
  locationTypeLabel: string;
  assetRoleCode: string;
  assetRoleLabel: string;
  /** `F4.278`: an asset of B, a published rule on `assetA` and a rule on `assetB`. */
  assetB: string;
  ruleA: string;
  ruleB: string;
  /** `F4.279`: a channel of A, and a fleet-wide (NULL-organization) channel. */
  channelA: string;
  fleetChannel: string;
  /** `F4.280`: a report schedule of A, stamped with `locationA`. */
  scheduleA: string;
  /** `F4.281`: a maintenance schedule of A on `assetA`, and its template's title. */
  maintenanceScheduleA: string;
  maintenanceTitleA: string;
  /** `F4.284` (DC1): a user of A (named `RESOLVER_NAMES.userA`) and a user of B. */
  userA: string;
  userB: string;
};

/** `locationA` carries a stored `builtin` view (`site_control_room_views`); `locationA2` carries none. */
export const RESOLVER_NAMES = {
  orgA: "F3.86 resolver A",
  locationA: "F3.86 site A",
  rtuA: "F3.86 RTU A",
  assetA: "F3.86 asset A",
  groupA: "F3.86 group A",
  assetTemplateA: "F4.254 asset template A",
  mimicLayoutA: "F3.87 layout A",
  userA: "F4.284 assignee A",
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
    // `F4.278`: the rule routes' two gates — the role class (a refusal throws) and the read scope.
    assertOperationsWriteRole: async (_user: JwtPayload, writeClass: string) => {
      calls.push(["assertOperationsWriteRole", writeClass]);
    },
    readableAssetIds: async () => {
      calls.push(["readableAssetIds"]);
      return null;
    },
    isOrganizationLevelAdmin: (_user: JwtPayload, organizationId: string) =>
      answer("isOrganizationLevelAdmin", organizationId),
    // `F4.279`: the notification routes' gate.
    canManageNotificationChannel: (_user: JwtPayload, organizationId: string | null) =>
      answer("canManageNotificationChannel", organizationId),
    // `F4.280`: the report schedule routes' verdict.
    canReadReportFile: (_user: JwtPayload, file: { organizationId: string; locationIds: readonly string[] }) =>
      answer("canReadReportFile", file.organizationId, [...file.locationIds]),
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

/**
 * `F3.86` PR 3a (plan §4.9, owed by this PR) — a location update whose body
 * names `parentId` is a move, which `LocationsAdminService.update` allows an
 * organization-level administrator of the node's organization only, whatever
 * the value (`null`, a move to the top level, included). The resolver asks
 * `isOrganizationLevelAdmin` on the location's organization, after the site
 * check; a body without `parentId` never asks it.
 */
export async function aLocationMoveNeedsAnOrganizationLevelAdmin(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "location", param: "id" });
  const toRoot = { parentId: null };
  // The refusal first, so a resolver that skips the check reddens here, at the claim.
  const below = recorder({ isOrganizationLevelAdmin: false });
  expect(await resolverWith(ctx, below.access).resolve(entry, { id: ctx.locationA }, toRoot, [ctx.orgA], JWT)).toBeNull();
  expect(below.calls).toContainEqual(["isOrganizationLevelAdmin", ctx.orgA]);
  const orgAdmin = recorder();
  expect(await resolverWith(ctx, orgAdmin.access).resolve(entry, { id: ctx.locationA }, toRoot, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.locationA,
  });
  expect(orgAdmin.calls).toEqual([
    ["requireMasterDataUser"],
    ["canManageLocation", ctx.locationA],
    ["isOrganizationLevelAdmin", ctx.orgA],
  ]);
  // The same caller, without `parentId`: the route asks nothing more, so neither does the resolver.
  const rename = recorder({ isOrganizationLevelAdmin: false });
  expect(await resolverWith(ctx, rename.access).resolve(entry, { id: ctx.locationA }, { name: "Renamed" }, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
  });
  expect(rename.calls.map(([name]) => name)).not.toContain("isOrganizationLevelAdmin");
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
    targetName: `${ctx.assetCodeA} ${ctx.pointKeyCode}`,
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

/**
 * `F3.86` PR 3b (plan §4.9, owed by this PR) — an asset update whose body
 * names `locationId` moves the asset, and `AssetsAdminService.update` checks
 * `canManageLocation` on the **new** site after `canManageAsset` (the asset
 * sits at `locationA`; the move names `locationA2`). The resolver asks the
 * same, on the same row; a body without `locationId` never asks it.
 */
export async function anAssetMoveNeedsTheNewSiteToo(ctx: ResolverCtx): Promise<void> {
  const entry = fixture({ kind: "asset", param: "id" });
  const move = { locationId: ctx.locationA2 };
  // The refusal first, so a resolver that skips the check reddens here, at the claim.
  const denied = recorder({ canManageLocation: false });
  expect(await resolverWith(ctx, denied.access).resolve(entry, { id: ctx.assetA }, move, [ctx.orgA], JWT)).toBeNull();
  // The new site, not the asset's own: an argument swap is the known survivor of a "was it called" check.
  expect(denied.calls).toEqual([
    ["canManageAsset", ctx.assetA],
    ["canManageLocation", ctx.locationA2],
  ]);
  const allowed = recorder();
  expect(await resolverWith(ctx, allowed.access).resolve(entry, { id: ctx.assetA }, move, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.assetA,
  });
  // The same caller, without `locationId`: the route asks nothing more, so neither does the resolver.
  const rename = recorder({ canManageLocation: false });
  expect(await resolverWith(ctx, rename.access).resolve(entry, { id: ctx.assetA }, { name: "Renamed" }, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
  });
  expect(rename.calls).toEqual([["canManageAsset", ctx.assetA]]);
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

/** `F4.282` (Amendment 8 D2): the vocabulary entries the resolver reads. */
const LOCATION_TYPE_ROW = fixture({ kind: "vocabulary", of: "locationType", param: "code" });
const ASSET_ROLE_ROW = fixture({ kind: "vocabulary", of: "assetRole", param: "code" });

/** Ruling Q1: a vocabulary row lives in the bound organization; an unbound conversation is refused. */
export async function aVocabularyRowNeedsABoundConversation(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  expect(await r.resolve(LOCATION_TYPE_ROW, { code: ctx.locationTypeCode }, {}, [ctx.orgA], JWT, null)).toBeNull();
  expect(await r.resolve(LOCATION_TYPE_ROW, { code: ctx.locationTypeCode }, {}, [ctx.orgA], JWT, ctx.orgA)).toMatchObject({
    organizationId: ctx.orgA,
  });
}

/**
 * A location type's card counts the locations that use it in the bound organization only — a
 * vocabulary target needs a bound conversation, so the turn's allowed list is that organization
 * (`resolveScope`). Two locations of A use the type and one of B; each bound turn counts its own.
 */
export async function aLocationTypeCountsItsLocationsInTheAllowedOrganizations(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  const params = { code: ctx.locationTypeCode };
  expect(await r.resolve(LOCATION_TYPE_ROW, params, {}, [ctx.orgA], JWT, ctx.orgA)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: ctx.locationTypeLabel,
    usageCount: 2,
  });
  expect(await r.resolve(LOCATION_TYPE_ROW, params, {}, [ctx.orgB], JWT, ctx.orgB)).toMatchObject({
    organizationId: ctx.orgB,
    usageCount: 1,
  });
}

/** An unknown code is refused before the route's gate is asked. */
export async function anUnknownVocabularyCodeIsRefusedBeforeTheGate(ctx: ResolverCtx): Promise<void> {
  const r = recorder();
  const params = { code: "f4282_absent" };
  expect(await resolverWith(ctx, r.access).resolve(LOCATION_TYPE_ROW, params, {}, [ctx.orgA], JWT, ctx.orgA)).toBeNull();
  expect(r.calls).toEqual([]);
}

/** The routes' `requireGlobalAdmin`: a master-data user, then a global admin, in that order. */
export async function aVocabularyRowNeedsTheGlobalAdmin(ctx: ResolverCtx): Promise<void> {
  const notGlobal = recorder({ isGlobalAdmin: false });
  const params = { code: ctx.assetRoleCode };
  expect(await resolverWith(ctx, notGlobal.access).resolve(ASSET_ROLE_ROW, params, {}, [ctx.orgA], JWT, ctx.orgA)).toBeNull();
  expect(notGlobal.calls).toEqual([["requireMasterDataUser"], ["isGlobalAdmin"]]);
}

/** A unit role resolves its label and carries no usage count. */
export async function aUnitRoleResolvesItsLabel(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  const resolved = await r.resolve(ASSET_ROLE_ROW, { code: ctx.assetRoleCode }, {}, [ctx.orgA], JWT, ctx.orgA);
  expect(resolved).toMatchObject({ organizationId: ctx.orgA, targetName: ctx.assetRoleLabel });
  expect(resolved).not.toHaveProperty("usageCount");
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

/**
 * `F4.254` PR 3 (plan §5.4) — the instantiate route's deploy authority
 * (`AssetTemplateInstantiationService.instantiate`, then
 * `instantiateTemplateCore`): a master-data user, `canManageOrganization` on
 * the template's organization, then `canManageLocation` on the target site.
 * That admits a `location_admin` on a site it manages; the authoring check
 * (`canManageTemplate`) the `assetTemplate` kind mirrors never does.
 */
const ASSETS = [{ code: "p1", name: "P1" }];

/**
 * The SHIPPED entry, not a hand-built fixture (precedent:
 * `copilot-target-resolver.spec.ts`'s `catalogEntry("onboarding.commit")`), so
 * the cases below hold the catalog's own target and refs: a target of
 * `assetTemplate` turns (a) red, and a dropped `locationId` ref turns (f) red.
 */
const deploy = (
  ctx: ResolverCtx,
  r: ReturnType<typeof recorder>,
  body: Record<string, unknown>,
  allowed: readonly string[] = [ctx.orgA],
) => resolverWith(ctx, r.access).resolve(catalogEntry("assetTemplate.instantiate")!, { id: ctx.assetTemplateA }, body, allowed, JWT);

/** (a) A `location_admin` on its site: the route's three checks, each on its own row, in order. */
export async function anInstantiateTargetAdmitsALocationAdminOnItsSite(ctx: ResolverCtx): Promise<void> {
  const r = recorder({}, "location_admin");
  expect(await deploy(ctx, r, { locationId: ctx.locationA, assets: ASSETS })).toMatchObject({
    organizationId: ctx.orgA,
    organizationName: RESOLVER_NAMES.orgA,
    targetName: RESOLVER_NAMES.assetTemplateA,
  });
  expect(r.calls).toEqual([
    ["requireMasterDataUser"],
    ["canManageOrganization", ctx.orgA],
    ["canManageLocation", ctx.locationA],
  ]);
}

/** (b) The site check is the one that refuses: a caller who manages the organization but not the site. */
export async function anInstantiateTargetNeedsTheSite(ctx: ResolverCtx): Promise<void> {
  const r = recorder({ canManageLocation: false }, "location_admin");
  expect(await deploy(ctx, r, { locationId: ctx.locationA, assets: ASSETS })).toBeNull();
  expect(r.calls).toContainEqual(["canManageLocation", ctx.locationA]);
}

/** (c) The RTU arm checks the RTU's own site, read from the RTU row (not the organization, not the body). */
export async function anInstantiateUnderAnRtuChecksTheRtusSite(ctx: ResolverCtx): Promise<void> {
  const r = recorder({}, "location_admin");
  expect(await deploy(ctx, r, { rtuId: ctx.rtuA, assets: ASSETS })).toMatchObject({ organizationId: ctx.orgA });
  expect(r.calls).toEqual([
    ["requireMasterDataUser"],
    ["canManageOrganization", ctx.orgA],
    ["canManageLocation", ctx.locationA],
  ]);
}

/** (d) The organization check refuses before the site is asked. */
export async function anInstantiateTargetNeedsTheOrganization(ctx: ResolverCtx): Promise<void> {
  const r = recorder({ canManageOrganization: false });
  expect(await deploy(ctx, r, { locationId: ctx.locationA, assets: ASSETS })).toBeNull();
  expect(r.calls).toContainEqual(["canManageOrganization", ctx.orgA]);
  expect(r.calls.map(([name]) => name)).not.toContain("canManageLocation");
}

/** (e1) The deploy kind never asks the authoring check — else a `location_admin` is never offered the card. */
export async function theDeployKindNeverAsksTheAuthoringCheck(ctx: ResolverCtx): Promise<void> {
  const r = recorder({}, "location_admin");
  expect(await deploy(ctx, r, { locationId: ctx.locationA, assets: ASSETS })).not.toBeNull();
  expect(r.calls.map(([name]) => name)).not.toContain("canManageTemplate");
}

/** (e2) …and the authoring kind on the same template asks `canManageTemplate` alone, never the deploy checks. */
export async function theAuthoringKindAsksOnlyTheAuthoringCheck(ctx: ResolverCtx): Promise<void> {
  const r = recorder();
  const entry = fixture({ kind: "assetTemplate", param: "id" });
  expect(await resolverWith(ctx, r.access).resolve(entry, { id: ctx.assetTemplateA }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.assetTemplateA,
  });
  expect(r.calls).toEqual([["canManageTemplate", ctx.orgA]]);
}

/**
 * `F4.246` — a template target carries its version's lifecycle status, for
 * the propose tool's mirror of the route's refusal: the published asset
 * template through both of its kinds, the dashboard template at its column
 * default (`draft`). Two distinct values, so a hard-coded status reddens one.
 */
export async function aTemplateTargetCarriesItsStatus(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  const authoring = await r.resolve(fixture({ kind: "assetTemplate", param: "id" }), { id: ctx.assetTemplateA }, {}, [ctx.orgA], JWT);
  expect(authoring?.status).toBe("published");
  expect((await deploy(ctx, recorder(), { locationId: ctx.locationA, assets: ASSETS }))?.status).toBe("published");
  const dashboard = await r.resolve(fixture({ kind: "dashboardTemplate", param: "id" }), { id: ctx.dashboardTemplateA }, {}, [ctx.orgA], JWT);
  expect(dashboard?.status).toBe("draft");
}

/**
 * (f) A target site of another organization is refused by the ref loop: the
 * recorder answers `true`, so the site check passed (its call is the proof),
 * and only the `locationId` ref of organization B is left to refuse it.
 */
export async function anInstantiateTargetOfAnotherOrganizationIsRefused(ctx: ResolverCtx): Promise<void> {
  const r = recorder();
  expect(await deploy(ctx, r, { locationId: ctx.locationB, assets: ASSETS })).toBeNull();
  expect(r.calls).toContainEqual(["canManageLocation", ctx.locationB]);
}

/** A body that names neither target (the route's refinement refuses it) has no site to check. */
export async function anInstantiateWithNoTargetIsRefused(ctx: ResolverCtx): Promise<void> {
  const r = recorder();
  expect(await deploy(ctx, r, { assets: ASSETS })).toBeNull();
  expect(r.calls.map(([name]) => name)).not.toContain("canManageLocation");
}

/**
 * Review L1 — an `rtuId` of another organization, with both organizations in
 * the turn's scope: the RTU's site is read on the template's organization
 * only, so it is not found, the site check is never asked (the RTU's site in
 * B never reaches `canManageLocation`), and the target is refused. The
 * positive twin is (c), the RTU of A.
 */
export async function anInstantiateUnderAnRtuOfAnotherOrganizationIsRefused(ctx: ResolverCtx): Promise<void> {
  const r = recorder();
  expect(await deploy(ctx, r, { rtuId: ctx.rtuB, assets: ASSETS }, [ctx.orgA, ctx.orgB])).toBeNull();
  expect(r.calls).toContainEqual(["canManageOrganization", ctx.orgA]);
  expect(r.calls.map(([name]) => name)).not.toContain("canManageLocation");
}

/**
 * `F3.87` PR 5 (owed by PR 2, ADR 0099 Amendment 3 A1) — `mimicLayout`: the
 * layout row is found for an organization admin inside its organization only,
 * under the tenant policy, and the mimic authoring check runs on that
 * organization. Across organizations (B allowed, the row in A) it is refused
 * before any check; a `location_admin` is refused by the role.
 */
export async function aMimicLayoutResolvesForAnOrgAdminInItsOrganizationOnly(ctx: ResolverCtx): Promise<void> {
  const entry = catalogEntry("mimicLayout.replace");
  if (!entry) throw new Error("mimicLayout.replace");
  const allowed = recorder({}, "organization_admin");
  expect(await resolverWith(ctx, allowed.access).resolve(entry, { id: ctx.mimicLayoutA }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    targetName: RESOLVER_NAMES.mimicLayoutA,
    organizationName: RESOLVER_NAMES.orgA,
  });
  expect(allowed.calls).toContainEqual(["canManageOrganization", ctx.orgA]);
  const across = recorder({}, "organization_admin");
  expect(await resolverWith(ctx, across.access).resolve(entry, { id: ctx.mimicLayoutA }, {}, [ctx.orgB], JWT)).toBeNull();
  expect(across.calls.filter(([name]) => name === "canManageOrganization")).toEqual([]);
  expect(await resolverWith(ctx, recorder({}, "location_admin").access).resolve(entry, { id: ctx.mimicLayoutA }, {}, [ctx.orgA], JWT)).toBeNull();
}

/**
 * `F4.245` (ADR 0099 Amendment 4): a slug names a dashboard only in the
 * allowed organizations; the tenant policy confines each read. Mutation: drop
 * the organization filter and read under one tenant only, or search every
 * organization: the B-only case finds A's dashboard.
 */
export async function aDashboardSlugIsFoundInTheAllowedSetOnly(ctx: ResolverCtx): Promise<void> {
  const resolver = resolverWith(ctx, recorder().access);
  expect(await resolver.dashboardIdBySlug(ctx.dashboardSlugA, [ctx.orgA])).toBe(ctx.dashboardA);
  expect(await resolver.dashboardIdBySlug(ctx.dashboardSlugA, [ctx.orgB])).toBeNull();
  expect(await resolver.dashboardIdBySlug("no-such-slug", [ctx.orgA, ctx.orgB])).toBeNull();
}

/**
 * `F4.245` review C1 (ADR 0099 Amendment 4, B2) — an open wizard's record is
 * resolved by its row alone, on the real resolver: an open grant-add drawer is
 * its user, and an open instantiate wizard is its template with the
 * organization check. The body-dependent checks (a grant's `kind` and
 * `targetId`, the instantiate's site) are what a fill is about to set, so they
 * never run here. Mutation: `resolveWizardRecord` asks the `"propose"` mode —
 * the two record cases (`anOpenGrantAddDrawerIsItsUsersRecord`,
 * `anOpenInstantiateWizardIsItsTemplatesRecord`) go red, as no record comes
 * back. The call-list cases and the unmanaged-organization case pin the checks
 * that run; with an empty body the `"propose"` mode records the same calls and
 * gives `null` too, so they do not carry that mutation.
 */
const wizardScope = (ctx: ResolverCtx): WizardScope => ({ allowedOrganizationIds: [ctx.orgA], user: JWT, conversationOrganizationId: ctx.orgA });

export async function anOpenGrantAddDrawerIsItsUsersRecord(ctx: ResolverCtx): Promise<void> {
  const record = await resolveWizardRecord(catalogEntry("userGrant.add")!, { id: "user-1" }, withUsers(ctx, userServices(ctx)), wizardScope(ctx));
  expect(record).toStrictEqual({ catalogId: "userGrant.add", params: { id: "user-1" }, name: "Priya Rao", organizationId: ctx.orgA });
}

/** The user checks run; the grant check (which reads the body) does not. */
export async function anOpenGrantAddDrawerNeverAsksTheGrantCheck(ctx: ResolverCtx): Promise<void> {
  const services = userServices(ctx);
  await resolveWizardRecord(catalogEntry("userGrant.add")!, { id: "user-1" }, withUsers(ctx, services), wizardScope(ctx));
  expect(services.calls).toEqual([["requireManager"], ["requireManageableTarget", "user-1"]]);
}

export async function anOpenInstantiateWizardIsItsTemplatesRecord(ctx: ResolverCtx): Promise<void> {
  const r = recorder({}, "location_admin");
  const record = await resolveWizardRecord(catalogEntry("assetTemplate.instantiate")!, { id: ctx.assetTemplateA }, resolverWith(ctx, r.access), wizardScope(ctx));
  expect(record).toStrictEqual({
    catalogId: "assetTemplate.instantiate",
    params: { id: ctx.assetTemplateA },
    name: RESOLVER_NAMES.assetTemplateA,
    organizationId: ctx.orgA,
  });
}

/** The organization check still runs, and no site is asked (the body names none). */
export async function anOpenInstantiateWizardAsksTheOrganizationCheckOnly(ctx: ResolverCtx): Promise<void> {
  const r = recorder({}, "location_admin");
  await resolveWizardRecord(catalogEntry("assetTemplate.instantiate")!, { id: ctx.assetTemplateA }, resolverWith(ctx, r.access), wizardScope(ctx));
  expect(r.calls).toEqual([["requireMasterDataUser"], ["canManageOrganization", ctx.orgA]]);
}

/** The adjacent negative: a caller who does not manage the template's organization gets no record. */
export async function anOpenInstantiateWizardOfAnUnmanagedOrganizationIsNotOpen(ctx: ResolverCtx): Promise<void> {
  const r = recorder({ canManageOrganization: false }, "location_admin");
  expect(
    await resolveWizardRecord(catalogEntry("assetTemplate.instantiate")!, { id: ctx.assetTemplateA }, resolverWith(ctx, r.access), wizardScope(ctx)),
  ).toBeNull();
}

/**
 * `F4.247` (ADR 0099 Amendment 5 C1): the `updated_at` the test file stamps on
 * dashboard A and asset template A, with microseconds, and the millisecond ISO
 * instant the resolver must read from each — the value the Confirm's
 * `If-Match` names.
 */
export const RESOLVER_STAMPS = {
  dashboardA: { stored: "2026-01-02 03:04:05.678901+00", iso: "2026-01-02T03:04:05.678Z" },
  assetTemplateA: { stored: "2026-01-03 04:05:06.789123+00", iso: "2026-01-03T04:05:06.789Z" },
} as const;

/** Mutation: select `dashboards.createdAt` for the stamp — a row stamped apart from its creation reads wrong. */
export async function aDashboardTargetCarriesItsUpdatedAt(ctx: ResolverCtx): Promise<void> {
  const target = await resolverWith(ctx, recorder().access).resolve(
    catalogEntry("dashboard.widgets.replace")!,
    { id: ctx.dashboardA },
    {},
    [ctx.orgA],
    JWT,
  );
  expect(target?.updatedAt).toBe(RESOLVER_STAMPS.dashboardA.iso);
}

/** Mutation: leave `updatedAt` out of the asset-template case — the target carries none. */
export async function anAssetTemplateTargetCarriesItsUpdatedAt(ctx: ResolverCtx): Promise<void> {
  const target = await resolverWith(ctx, recorder().access).resolve(
    catalogEntry("assetTemplate.update")!,
    { id: ctx.assetTemplateA },
    {},
    [ctx.orgA],
    JWT,
  );
  expect(target?.updatedAt).toBe(RESOLVER_STAMPS.assetTemplateA.iso);
}

/** `F4.278` (Amendment 8 D2): the rule target on a real database. */
const RULE_ROW = fixture({ kind: "rule", param: "id" });
const RULE_UPDATE = fixture({ kind: "rule", param: "id" }, [{ field: "assetId", kind: "asset" }]);

/** A rule of another organization is not found: the read is bounded to the turn's organizations. */
export async function aRuleOfAnotherOrganizationIsNotFound(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  expect(await r.resolve(RULE_ROW, { id: ctx.ruleB }, {}, [ctx.orgA], JWT)).toBeNull();
  expect(await r.resolve(RULE_ROW, { id: ctx.ruleA }, {}, [ctx.orgA], JWT)).toMatchObject({
    organizationId: ctx.orgA,
    lifecycle: "published",
  });
}

/**
 * The refs rule: a rule update naming an asset of another organization is refused, beside its
 * allowed twin naming an asset of the rule's own organization; the recorder proves the route's
 * read-scope gate was asked.
 */
export async function aRuleUpdateRefusesAnAssetOfAnotherOrganization(ctx: ResolverCtx): Promise<void> {
  const allowed = recorder();
  expect(
    await resolverWith(ctx, allowed.access).resolve(RULE_UPDATE, { id: ctx.ruleA }, { assetId: ctx.assetA }, [ctx.orgA], JWT),
  ).toMatchObject({ organizationId: ctx.orgA });
  expect(allowed.calls).toEqual([["assertOperationsWriteRole", "configuration"], ["readableAssetIds"]]);
  const refused = recorder();
  expect(
    await resolverWith(ctx, refused.access).resolve(RULE_UPDATE, { id: ctx.ruleA }, { assetId: ctx.assetB }, [ctx.orgA], JWT),
  ).toBeNull();
}

/**
 * `F4.279` (ADR 0099 Amendment 8 D2, Q13): a fleet-wide (NULL-organization) channel is found
 * under no tenant, so no copilot card names one — beside its allowed twin, a channel of A, which
 * resolves with the route's gate asked on A.
 */
export async function aFleetWideChannelIsNotFound(ctx: ResolverCtx): Promise<void> {
  const update = catalogEntry("notificationChannel.update");
  if (!update) throw new Error("notificationChannel.update");
  const r = resolverWith(ctx, recorder().access);
  expect(await r.resolve(update, { id: ctx.fleetChannel }, { name: "x" }, [ctx.orgA, ctx.orgB], JWT)).toBeNull();
  const allowed = recorder();
  expect(
    await resolverWith(ctx, allowed.access).resolve(update, { id: ctx.channelA }, { name: "x" }, [ctx.orgA], JWT),
  ).toMatchObject({ organizationId: ctx.orgA, targetName: "F4.279 channel A" });
  expect(allowed.calls).toEqual([["requireMasterDataUser"], ["canManageNotificationChannel", ctx.orgA]]);
}

/**
 * `F4.280` (ADR 0099 Amendment 8 D2): a stored report schedule of A resolves by its name, with the
 * route's verdict asked on its organization and its stamped locations — beside its refused twin,
 * the same schedule when the turn allows only B (the organization filter finds no row there).
 */
export async function aReportScheduleResolvesWithItsStampedLocations(ctx: ResolverCtx): Promise<void> {
  const update = catalogEntry("reportSchedule.update");
  if (!update) throw new Error("reportSchedule.update");
  const allowed = recorder();
  expect(
    await resolverWith(ctx, allowed.access).resolve(update, { id: ctx.scheduleA }, { name: "x" }, [ctx.orgA], JWT),
  ).toMatchObject({ organizationId: ctx.orgA, targetName: "F4.280 schedule A" });
  expect(allowed.calls).toEqual([["requireMasterDataUser"], ["canReadReportFile", ctx.orgA, [ctx.locationA]]]);
  expect(await resolverWith(ctx, recorder().access).resolve(update, { id: ctx.scheduleA }, { name: "x" }, [ctx.orgB], JWT)).toBeNull();
}

/**
 * `F4.281` (Amendment 8 D2): a maintenance schedule is looked for in the allowed organizations only — the
 * organization filter the unit fake cannot prove. Under A it resolves by its template's title; under B it is
 * not found.
 */
export async function aMaintenanceScheduleOfAnotherOrganizationIsNotFound(ctx: ResolverCtx): Promise<void> {
  const entry = catalogEntry("maintenanceSchedule.deactivate");
  if (!entry) throw new Error("maintenanceSchedule.deactivate");
  const r = resolverWith(ctx, recorder().access);
  expect((await r.resolve(entry, { id: ctx.maintenanceScheduleA }, { active: false }, [ctx.orgA], JWT))?.targetName).toBe(
    ctx.maintenanceTitleA,
  );
  expect(await r.resolve(entry, { id: ctx.maintenanceScheduleA }, { active: false }, [ctx.orgB], JWT)).toBeNull();
}

/**
 * `F4.284` (owner ruling DC1) — an `assignedTo` ref on a real database, as `bms_tenant`: `bms.users`
 * carries FORCE ROW LEVEL SECURITY, so a read outside the change's tenant finds no row. A user of A
 * resolves and is the target's `refName` (the card's "assigned to"); a user of B is refused beside it.
 */
export async function anAssigneeIsReadUnderTheTenantAndNamed(ctx: ResolverCtx): Promise<void> {
  const r = resolverWith(ctx, recorder().access);
  const entry = fixture({ kind: "location", param: "id" }, [{ field: "assignedTo", kind: "user" }]);
  const at = (assignedTo: string) => r.resolve(entry, { id: ctx.locationA }, { assignedTo }, [ctx.orgA, ctx.orgB], JWT);
  expect((await at(ctx.userA))?.refName).toBe(RESOLVER_NAMES.userA);
  expect(await at(ctx.userB)).toBeNull();
}

/**
 * `F4.283` (owner ruling 2026-10-25, Q2) — the readings' `telemetry` target on a real database, as
 * `bms_tenant`: each row's asset is read under its tenant (FORCE RLS on `bms.assets`) in the turn's
 * allowed organizations, the route's `canManageAsset` runs on it, and it must be of the bound
 * organization. A refusal is a `CopilotTargetRefusal` naming the rows.
 */
const READING_TIME = "2026-10-20T09:00:00.000Z";
const readingsAt = (ctx: ResolverCtx, access: never, ...assetIds: string[]) => {
  const entry = catalogEntry("telemetryReading.create");
  if (!entry) throw new Error("telemetryReading.create");
  const rows = assetIds.map((assetId) => ({ assetId, pointKey: "kw", value: 1, time: READING_TIME }));
  return resolverWith(ctx, access).resolve(entry, {}, { rows }, [ctx.orgA, ctx.orgB], JWT, ctx.orgA);
};
const refusalOf = (result: Promise<unknown>) =>
  result.then(
    () => "resolved",
    (err: unknown) => [err instanceof CopilotTargetRefusal, (err as Error).message],
  );

/** An asset of the bound organization resolves, with `canManageAsset` asked on it. */
export async function readingsOfABoundAssetResolveOnItsAsset(ctx: ResolverCtx): Promise<void> {
  const r = recorder();
  const resolved = await readingsAt(ctx, r.access, ctx.assetA);
  expect([resolved?.organizationId, r.calls.filter(([name]) => name === "canManageAsset")]).toEqual([
    ctx.orgA,
    [["canManageAsset", ctx.assetA]],
  ]);
}

/** An asset of B — found under B's tenant only — is outside the conversation's organization A. */
export async function readingsOfAnotherOrganizationsAssetAreRefusedByRow(ctx: ResolverCtx): Promise<void> {
  expect(await refusalOf(readingsAt(ctx, recorder().access, ctx.assetA, ctx.assetB))).toEqual([
    true,
    "Row 2: the asset is outside this conversation's organization.",
  ]);
}

/** An id that is no asset, and an asset the caller may not manage, share the route's disclosure-safe sentence. */
export async function readingsOfAnUnknownAssetAreRefusedByRow(ctx: ResolverCtx): Promise<void> {
  const unknown = "99999999-9999-4999-8999-999999999999";
  expect(await refusalOf(readingsAt(ctx, recorder().access, unknown, ctx.assetA))).toEqual([
    true,
    "Row 1: Asset not found or outside your access scope.",
  ]);
}

/** `canManageAsset` false on a real asset of A is the same refusal. */
export async function readingsOfAnUnmanageableAssetAreRefusedByRow(ctx: ResolverCtx): Promise<void> {
  expect(await refusalOf(readingsAt(ctx, recorder({ canManageAsset: false }).access, ctx.assetA))).toEqual([
    true,
    "Row 1: Asset not found or outside your access scope.",
  ]);
}
