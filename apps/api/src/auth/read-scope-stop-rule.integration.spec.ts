import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "./access-control.service";
import type { ReadScopeSource } from "./access-scope";
import { readScopeSourceYields, scopeFromSource, type ScopeUser } from "./access-scope-sources";

/**
 * `F4.161` — `readableOrganizationIds` and `scopeForUser` resolve from one
 * source-selection walk (`selectReadScopeSourceFor`), so a mixed-grant
 * `viewer`/`operator` reads the organizations of the source its location/asset
 * scope comes from, not the first source that merely has a grant row.
 *
 * The `.test.ts` sibling owns the fixtures: an organization with only an
 * inactive location (`ORG_EMPTY`), that location (`LOC_INACTIVE`), and an asset
 * group under it (`GROUP_INACTIVE`); seeded rows it reads but never writes are
 * the ESKOM site `wc-admin@bms.local` holds and the ESKOM group
 * `wc-hvac-admin@bms.local` holds. No fixture location is active and no fixture
 * group sits under a seeded location, so no other suite's active-filtered or
 * oldest-group read can see a fixture row.
 *
 * S1–S3 are the fix: red on main, where `readableOrganizationIds` stopped at the
 * first source with any grant row. S4–S7 hold single-source roles and a plain
 * organization grant unchanged. S8/S9 are invariance guards for `scopeForUser`
 * (plan D5), green before and after. E1–E9 gate the cheap probe against
 * `scopeFromSource` on the real database.
 */

/** S1–S7: `readableOrganizationIds` for this actor is exactly `expected`. */
export async function assertReadableOrganizationIds(
  svc: AccessControlService,
  jwt: JwtPayload,
  expected: readonly string[],
): Promise<void> {
  const ids = await svc.readableOrganizationIds(jwt);
  expect(ids).not.toBeNull();
  expect([...(ids ?? [])].sort()).toEqual([...expected].sort());
}

/**
 * S8: an organization grant that reaches no active site falls through to the
 * location grant — `currentUser` reports a location scope on exactly that site.
 */
export async function assertScopeFallsThroughToLocationGrant(
  svc: AccessControlService,
  jwt: JwtPayload,
  locationId: string,
): Promise<void> {
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("location");
  expect(scope.locations.map((location) => location.id)).toEqual([locationId]);
}

/** S9: grants that reach no active site anywhere resolve to the fail-closed `none` scope. */
export async function assertScopeFailsClosedToNone(
  svc: AccessControlService,
  jwt: JwtPayload,
): Promise<void> {
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("none");
}

/**
 * S10a: an inactive location grant beside an active asset-group grant falls
 * through to the asset-group source — `currentUser` reports `kind:
 * "asset_group"`, not the inactive location's `"location"`.
 */
export async function assertScopeFallsThroughToAssetGroupKind(
  svc: AccessControlService,
  jwt: JwtPayload,
): Promise<void> {
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("asset_group");
}

/** S10b: the asset-group scope's ids are exactly the granted group, not the fallback location's. */
export async function assertScopeAssetGroupIdsAreExactly(
  svc: AccessControlService,
  jwt: JwtPayload,
  assetGroupId: string,
): Promise<void> {
  const { scope } = await svc.currentUser(jwt);
  expect(scope.assetGroups.map((group) => group.id)).toEqual([assetGroupId]);
}

/**
 * E1–E9: the `LIMIT 1` probe answers exactly what `scopeFromSource` would —
 * the source yields iff its scope has a location or an asset.
 */
export async function assertProbeMatchesScopeFromSource(
  fleetDb: BmsDb,
  user: ScopeUser,
  source: ReadScopeSource,
): Promise<void> {
  const [probe, scope] = await Promise.all([
    readScopeSourceYields(fleetDb, user, source),
    scopeFromSource(fleetDb, user, source),
  ]);
  expect(probe).toBe(scope.locations.length > 0 || scope.assetIds.length > 0);
}
