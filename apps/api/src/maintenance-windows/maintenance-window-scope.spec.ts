import { expect } from "vitest";

import type { AccessibleScope, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";

import {
  everyTargetInScope,
  isUnrestricted,
  readScopeFor,
  scopedReadScope,
  targetInScope,
  targetVisibleTo,
  UNRESTRICTED_SCOPE,
  type MaintenanceWindowReadScope,
  type ResolvedTarget,
} from "./maintenance-window-scope";

/**
 * `F4.359` U3 (ADR 0131 decision 4, plan D15 and section 7) — the pure scope
 * predicates of `maintenance-window-scope.ts`. Assertions live here; the
 * sibling `.test.ts` runs them (ADR 0014). The database half is
 * `maintenance-windows.service.rls.integration.spec.ts`'s.
 */

const ORG = "10000000-0000-4000-8000-000000000001";
const SITE = "20000000-0000-4000-8000-000000000001";
const CHILD = "20000000-0000-4000-8000-000000000002";
const OTHER_SITE = "20000000-0000-4000-8000-000000000003";
const ASSET = "30000000-0000-4000-8000-000000000001";
const OTHER_ASSET = "30000000-0000-4000-8000-000000000002";
const RULE = "40000000-0000-4000-8000-000000000001";

const asset = (id: string): ResolvedTarget => ({ kind: "asset", id, organizationId: ORG });
const location = (id: string): ResolvedTarget => ({ kind: "location", id, organizationId: ORG });
const rule = (assetId: string | null): ResolvedTarget => ({ kind: "rule", id: RULE, organizationId: ORG, assetId });

function accessible(kind: AccessibleScope["kind"], locationIds: readonly string[], assetIds: readonly string[]): AccessibleScope {
  return {
    kind,
    locations: locationIds.map((id) => ({ id, code: id, slug: id, name: id, type: "site", province: null, parentId: null })),
    assetGroups: [],
    assetIds: [...assetIds],
  } as AccessibleScope;
}

/** A location admin of SITE: the closure SITE + CHILD, and the asset there. */
const siteAdmin: MaintenanceWindowReadScope = scopedReadScope(accessible("location", [SITE, CHILD], [ASSET]), [ORG]);
/** An asset-group admin whose group sits at SITE and holds ASSET alone. */
const groupAdmin: MaintenanceWindowReadScope = scopedReadScope(accessible("asset_group", [SITE], [ASSET]), [ORG]);

/** `isUnrestricted` is the admin's null asset set and nothing else. */
export function unrestrictedIsTheNullAssetSet(): void {
  expect(isUnrestricted(UNRESTRICTED_SCOPE)).toBe(true);
  expect(isUnrestricted(siteAdmin)).toBe(false);
  expect(isUnrestricted({ ...siteAdmin, assetIds: [] })).toBe(false);
}

/** The scope's `kind` decides the location-target set: a location scope's locations, an asset-group scope's none. */
export function onlyALocationSourcedScopeNamesLocations(): void {
  expect(siteAdmin.locationIds).toEqual([SITE, CHILD]);
  expect(siteAdmin.subtreeLocationIds).toEqual([SITE, CHILD]);
  expect(groupAdmin.locationIds).toEqual([SITE]);
  expect(groupAdmin.subtreeLocationIds).toEqual([]);
  expect(scopedReadScope(accessible("none", [], []), []).subtreeLocationIds).toEqual([]);
}

/** Item 1: an asset-group admin cannot name its group's location, and may name a member asset or a rule on it. */
export function anAssetGroupAdminNamesNoLocation(): void {
  expect(targetInScope(location(SITE), groupAdmin)).toBe(false);
  expect(targetInScope(asset(ASSET), groupAdmin)).toBe(true);
  expect(targetInScope(rule(ASSET), groupAdmin)).toBe(true);
  // Positive neighbour: the location admin of the same site names it.
  expect(targetInScope(location(SITE), siteAdmin)).toBe(true);
  expect(targetInScope(location(CHILD), siteAdmin)).toBe(true);
}

/** Every kind outside the scope is refused; the admin may name anything. */
export function targetInScopeKeepsToTheReadableSets(): void {
  expect(targetInScope(location(OTHER_SITE), siteAdmin)).toBe(false);
  expect(targetInScope(asset(OTHER_ASSET), siteAdmin)).toBe(false);
  expect(targetInScope(rule(OTHER_ASSET), siteAdmin)).toBe(false);
  expect(targetInScope(rule(null), siteAdmin)).toBe(false);
  for (const target of [location(OTHER_SITE), asset(OTHER_ASSET), rule(null)]) {
    expect(targetInScope(target, UNRESTRICTED_SCOPE)).toBe(true);
  }
}

/** D15: every target must be in scope, and no target at all never passes. */
export function everyTargetMeansEveryAndNotNone(): void {
  expect(everyTargetInScope([location(SITE), asset(ASSET)], siteAdmin)).toBe(true);
  expect(everyTargetInScope([location(SITE), location(OTHER_SITE)], siteAdmin)).toBe(false);
  expect(everyTargetInScope([location(SITE)], groupAdmin)).toBe(false);
  expect(everyTargetInScope([], siteAdmin)).toBe(false);
  expect(everyTargetInScope([], UNRESTRICTED_SCOPE)).toBe(false);
}

/** Item 2: a target is shown by its readable asset, its rule's asset, or a visible location. */
export function aTargetIsShownOnlyWhenReadable(): void {
  const visible = [SITE, CHILD];
  expect(targetVisibleTo({ kind: "asset", id: ASSET }, siteAdmin, visible)).toBe(true);
  expect(targetVisibleTo({ kind: "asset", id: OTHER_ASSET }, siteAdmin, visible)).toBe(false);
  expect(targetVisibleTo({ kind: "rule", id: RULE, assetId: ASSET }, siteAdmin, visible)).toBe(true);
  expect(targetVisibleTo({ kind: "rule", id: RULE, assetId: null }, siteAdmin, visible)).toBe(false);
  expect(targetVisibleTo({ kind: "location", id: SITE }, siteAdmin, visible)).toBe(true);
  expect(targetVisibleTo({ kind: "location", id: OTHER_SITE }, siteAdmin, visible)).toBe(false);
  expect(targetVisibleTo({ kind: "location", id: OTHER_SITE }, UNRESTRICTED_SCOPE, null)).toBe(true);
}

/** `readScopeFor`: the admin walks no scope; anyone else maps its `AccessibleScope` and organizations. */
export async function readScopeForAsksTheRoleFirst(): Promise<void> {
  const calls: string[] = [];
  const jwt: JwtPayload = { sub: "u", email: "u@bms.local", name: "u", role: "asset_group_admin" };
  const access = (admin: boolean) => ({
    async isGlobalAdmin(): Promise<boolean> {
      calls.push("role");
      return admin;
    },
    async currentUser() {
      calls.push("scope");
      return { scope: accessible("asset_group", [SITE], [ASSET]) } as Awaited<ReturnType<AccessControlService["currentUser"]>>;
    },
    async readableOrganizationIds(): Promise<string[] | null> {
      calls.push("organizations");
      return [ORG];
    },
  });
  expect(await readScopeFor(access(true), jwt)).toEqual(UNRESTRICTED_SCOPE);
  expect(calls).toEqual(["role"]);
  calls.length = 0;
  expect(await readScopeFor(access(false), jwt)).toEqual({ assetIds: [ASSET], locationIds: [SITE], organizationIds: [ORG], subtreeLocationIds: [] });
  expect(calls).toEqual(["role", "scope", "organizations"]);
}
