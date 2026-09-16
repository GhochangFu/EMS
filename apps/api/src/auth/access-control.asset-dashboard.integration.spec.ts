import { expect } from "vitest";
import type pg from "pg";

import type { AccessControlService } from "./access-control.service";
import { jwtFor, SEEDED } from "./access-control.integration.spec";

/**
 * `F3.2` Task 4 — `canManageDashboard`'s ASSET arm (ADR 0067 decision 2, plan D9).
 *
 * A separate file from `access-control.integration.spec.ts` for a mechanical reason: that file
 * is at 975 of the 1000-line whole-file cap the pre-commit hook enforces, so the ten claims
 * below could not live there. The two share `jwtFor`/`SEEDED` rather than restating them.
 *
 * **Every id is read from the database, never hardcoded.** A uuid literal in a test is a
 * fixture that stops existing the first time the seed changes, and the failure it then
 * produces ("no such asset") looks like the feature being broken rather than the test.
 *
 * Reads use `ORDER BY created_at, id LIMIT 1` for the `F4.53` reason the sibling suites give:
 * the oldest row is a seeded one, and a seeded row is the only row a concurrent integration
 * suite cannot delete out from under this fixture — several are in flight in the same run.
 *
 * Read-only: nothing here inserts, updates or deletes.
 */

export type AssetDashboardFixtures = {
  readonly eskomOrgId: string;
  readonly phewbOrgId: string;
  /** `wc-admin@bms.local`'s own granted location. */
  readonly locationAdminLocationId: string;
  /** An asset AT that location — the one the location arm must admit. */
  readonly assetInOwnLocationId: string;
  /** An asset in the SAME organization but at a DIFFERENT location. */
  readonly assetInOtherLocationId: string;
  /** An asset belonging to the other organization entirely. */
  readonly foreignOrgAssetId: string;
  /** `wc-hvac-admin@bms.local`'s own granted asset group. */
  readonly assetGroupAdminGroupId: string;
  /** An asset that IS a member of that group. */
  readonly memberAssetId: string;
  /** An asset in the same organization that is NOT a member of that group. */
  readonly nonMemberAssetId: string;
};

async function one<T extends Record<string, unknown>>(
  pool: pg.Pool,
  sql: string,
  params: unknown[],
  what: string,
): Promise<T> {
  const { rows } = await pool.query<T>(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error(`F3.2: ${what} — not found; run pnpm db:seed`);
  }
  return row;
}

export async function resolveAssetDashboardFixtures(pool: pg.Pool): Promise<AssetDashboardFixtures> {
  const eskom = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    [],
    "the ESKOM organization",
  );
  const phewb = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.organizations WHERE code = 'PHEWB' LIMIT 1`,
    [],
    "the PHEWB organization",
  );
  const location = await one<{ id: string }>(
    pool,
    `SELECT l.id
       FROM bms.locations l
       JOIN bms.user_location_access ula ON ula.location_id = l.id
       JOIN bms.users u ON u.id = ula.user_id
      WHERE u.email = $1
      ORDER BY l.created_at, l.id LIMIT 1`,
    [SEEDED.locationAdmin],
    `${SEEDED.locationAdmin}'s location grant`,
  );
  const ownLocationAsset = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.assets WHERE organization_id = $1 AND location_id = $2
      ORDER BY created_at, id LIMIT 1`,
    [eskom.id, location.id],
    "an asset at the location admin's own location",
  );
  const otherLocationAsset = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.assets WHERE organization_id = $1 AND location_id <> $2
      ORDER BY created_at, id LIMIT 1`,
    [eskom.id, location.id],
    "an asset at another location of the same organization",
  );
  const foreignAsset = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
    [phewb.id],
    "an asset in the other organization",
  );
  const group = await one<{ id: string; organization_id: string }>(
    pool,
    `SELECT ag.id, ag.organization_id
       FROM bms.asset_groups ag
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = ag.id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE u.email = $1
      ORDER BY ag.created_at, ag.id LIMIT 1`,
    [SEEDED.assetGroupAdmin],
    `${SEEDED.assetGroupAdmin}'s asset-group grant`,
  );
  const memberAsset = await one<{ id: string }>(
    pool,
    `SELECT a.id
       FROM bms.asset_group_members m
       JOIN bms.assets a ON a.id = m.asset_id
      WHERE m.asset_group_id = $1
      ORDER BY a.created_at, a.id LIMIT 1`,
    [group.id],
    "a member asset of the asset-group admin's group",
  );
  const nonMemberAsset = await one<{ id: string }>(
    pool,
    `SELECT a.id
       FROM bms.assets a
      WHERE a.organization_id = $1
        AND NOT EXISTS (
              SELECT 1 FROM bms.asset_group_members m
               WHERE m.asset_id = a.id AND m.asset_group_id = $2
            )
      ORDER BY a.created_at, a.id LIMIT 1`,
    [group.organization_id, group.id],
    "a non-member asset in the same organization",
  );

  return {
    eskomOrgId: eskom.id,
    phewbOrgId: phewb.id,
    locationAdminLocationId: location.id,
    assetInOwnLocationId: ownLocationAsset.id,
    assetInOtherLocationId: otherLocationAsset.id,
    foreignOrgAssetId: foreignAsset.id,
    assetGroupAdminGroupId: group.id,
    memberAssetId: memberAsset.id,
    nonMemberAssetId: nonMemberAsset.id,
  };
}

/** The asset scope, spelled once — all three axes, `assetId` alone non-null. */
const assetScope = (assetId: string) => ({ locationId: null, assetGroupId: null, assetId });

/** A1 (control) — `admin` manages an asset-scoped dashboard in ANY organization. */
export async function assertA1AdminManagesAnyAssetScope(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const admin = jwtFor(SEEDED.globalAdmin, "admin");
  expect(
    await svc.canManageDashboard(admin, f.eskomOrgId, assetScope(f.assetInOwnLocationId)),
    "admin must manage an asset-scoped dashboard in ESKOM",
  ).toBe(true);
  expect(
    await svc.canManageDashboard(admin, f.phewbOrgId, assetScope(f.foreignOrgAssetId)),
    "admin must manage an asset-scoped dashboard in PHEWB too",
  ).toBe(true);
}

/**
 * A2 — `organization_admin` is true for its OWN organization, false for another's.
 *
 * The organization arm never looks at the asset at all: the id under test is the
 * `organizationId` the dashboard is stamped with, which is the only thing that role's
 * authority is about.
 */
export async function assertA2OrganizationAdminIsBoundToItsOwnOrganization(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const orgAdmin = jwtFor(SEEDED.organizationAdmin, "organization_admin");
  expect(
    await svc.canManageDashboard(orgAdmin, f.phewbOrgId, assetScope(f.foreignOrgAssetId)),
    "organization_admin must manage an asset-scoped dashboard in its own organization",
  ).toBe(true);
  expect(
    await svc.canManageDashboard(orgAdmin, f.eskomOrgId, assetScope(f.assetInOwnLocationId)),
    "organization_admin must be refused another organization's asset-scoped dashboard",
  ).toBe(false);
}

/**
 * A3 — `location_admin` manages an asset AT its own location, in its own organization.
 *
 * This is the claim the whole arm exists for: without it, `target.kind` is never `"location"`
 * for an asset scope and the method falls straight through to `false`.
 */
export async function assertA3LocationAdminManagesAnAssetAtItsOwnLocation(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
  expect(
    await svc.canManageDashboard(locationAdmin, f.eskomOrgId, assetScope(f.assetInOwnLocationId)),
    "location_admin must manage a dashboard scoped to an asset AT its own location",
  ).toBe(true);
}

/** A4 — and is refused an asset at ANOTHER location of the same organization. */
export async function assertA4LocationAdminRefusedAnAssetAtAnotherLocation(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
  expect(
    await svc.canManageDashboard(locationAdmin, f.eskomOrgId, assetScope(f.assetInOtherLocationId)),
    "location_admin must be refused an asset at a location it does not hold — canManageLocation " +
      "must be consulted with the ASSET'S location, not merely with the organization",
  ).toBe(false);
}

/**
 * A5 — the finding-4 shape, one column over. The location admin's OWN asset must not authorize
 * a dashboard stamped with ANOTHER organization's id: `canManageLocation` answers "may this
 * user manage this location", never "does this asset belong to `organizationId`".
 */
export async function assertA5LocationAdminRefusedAForeignOrganizationStamp(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
  expect(
    await svc.canManageDashboard(locationAdmin, f.phewbOrgId, assetScope(f.assetInOwnLocationId)),
    "the location admin's own asset must NOT authorize a dashboard stamped with another " +
      "organization's id — assetBelongsToOrganization is the check that refuses it",
  ).toBe(false);
}

/** A6 — `asset_group_admin` manages an asset that is a MEMBER of its own group. */
export async function assertA6AssetGroupAdminManagesAMemberAsset(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const groupAdmin = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
  expect(
    await svc.canManageDashboard(groupAdmin, f.eskomOrgId, assetScope(f.memberAssetId)),
    "asset_group_admin must manage a dashboard scoped to an asset in its own group",
  ).toBe(true);
}

/** A7 — and is refused a non-member asset in the same organization. */
export async function assertA7AssetGroupAdminRefusedANonMemberAsset(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const groupAdmin = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
  expect(
    await svc.canManageDashboard(groupAdmin, f.eskomOrgId, assetScope(f.nonMemberAssetId)),
    "asset_group_admin must be refused an asset that is not a member of any group it holds — " +
      "dropping the asset_group_members join makes this true for every asset in the org",
  ).toBe(false);
}

/**
 * A7b — the membership join's ORGANIZATION predicate, which nothing else reaches.
 *
 * Added after the mutation run: deleting `eq(assetGroups.organizationId, organizationId)`
 * left A1–A10 entirely green, because `assetBelongsToOrganization` had already proved the
 * ASSET's organization and every seeded group lives in its own assets' organization. The
 * state the predicate actually guards is a group in organization B that holds a member asset
 * of organization A — `bms.asset_group_members` carries no organization column and the
 * database permits exactly that row.
 *
 * So the row is created here, asserted on, and deleted in a `finally`: a leaked cross-tenant
 * grant is not a fixture to leave behind for another suite in the same run. The
 * create-a-foreign-group-and-delete-it precedent is `assertCanManageDashboard`'s in
 * `access-control.integration.spec.ts`.
 */
export async function assertA7bGroupInAnotherOrganizationDoesNotAuthorize(
  svc: AccessControlService,
  pool: pg.Pool,
  f: AssetDashboardFixtures,
): Promise<void> {
  const foreignLocation = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
    [f.phewbOrgId],
    "a location in the other organization",
  );
  const suffix = `${Date.now()}`;
  const group = await one<{ id: string }>(
    pool,
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
     VALUES ($1, $2, $3, 'F3.2 cross-organization group proof') RETURNING id`,
    [f.phewbOrgId, foreignLocation.id, `f32-xorg-${suffix}`],
    "the cross-organization fixture group",
  );
  const user = await one<{ id: string }>(
    pool,
    `SELECT id FROM bms.users WHERE email = $1 LIMIT 1`,
    [SEEDED.assetGroupAdmin],
    `${SEEDED.assetGroupAdmin}`,
  );
  try {
    await pool.query(
      `INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)`,
      [user.id, group.id],
    );
    await pool.query(
      `INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`,
      [group.id, f.nonMemberAssetId],
    );

    const groupAdmin = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
    expect(
      await svc.canManageDashboard(groupAdmin, f.eskomOrgId, assetScope(f.nonMemberAssetId)),
      "a group belonging to ANOTHER organization must not authorize an asset-scoped dashboard " +
        "stamped with this one — the asset_groups.organization_id predicate on the membership " +
        "join is what refuses it",
    ).toBe(false);
  } finally {
    await pool.query(`DELETE FROM bms.asset_group_members WHERE asset_group_id = $1`, [group.id]);
    await pool.query(`DELETE FROM bms.user_asset_group_access WHERE asset_group_id = $1`, [group.id]);
    await pool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [group.id]);
  }
}

/**
 * A8 — `viewer`/`operator` are refused, and refused by RETURNING FALSE rather than by throwing.
 * An unprovisioned email so `resolveDbUser` falls back to the claim (ADR 0017/0044) instead of
 * resolving a seeded admin row that would make this vacuous.
 */
export async function assertA8ViewerAndOperatorAreRefusedWithoutThrowing(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  for (const role of ["viewer", "operator"] as const) {
    const jwt = jwtFor(`f3.2-no-grants-${role}@integration.invalid`, role);
    expect(
      await svc.canManageDashboard(jwt, f.eskomOrgId, assetScope(f.assetInOwnLocationId)),
      `${role} must be refused an asset-scoped dashboard`,
    ).toBe(false);
  }
}

/**
 * A9 — two axes set at once resolves to `{kind: "invalid"}` and returns `false`; it must NOT
 * throw. `DashboardsService.update` calls `canManageDashboard` with the MERGED scope BEFORE
 * its own 400 check precisely so an unauthorized caller gets a 404 rather than a disclosure,
 * so this state genuinely reaches `resolveScopeTarget` in normal operation.
 */
export async function assertA9TwoAxesSetIsFalseNotAThrow(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
  const both = {
    locationId: f.locationAdminLocationId,
    assetGroupId: null,
    assetId: f.assetInOwnLocationId,
  };
  let caught: unknown;
  let result: boolean | undefined;
  try {
    result = await svc.canManageDashboard(locationAdmin, f.eskomOrgId, both);
  } catch (err) {
    caught = err;
  }
  expect(
    caught,
    `{locationId, assetId} both set must not throw — resolveScopeTarget must return ` +
      `{kind: "invalid"} for it: ${String((caught as Error)?.message ?? "")}`,
  ).toBeUndefined();
  expect(result, "a scope with two axes set must be refused").toBe(false);
}

/**
 * A10 — the ruling-2 guard still refuses an all-null scope by returning `false`, and still
 * refuses it BEFORE `resolveScopeTarget` (which throws on that state, deliberately, so that
 * deleting the guard surfaces as a crash on this exact case rather than as a second silent
 * `false`). The guard now has to count THREE nulls; one that still counts two would let an
 * organization-wide scope reach the throw.
 */
export async function assertA10AllNullScopeIsStillRefusedNotThrown(
  svc: AccessControlService,
  f: AssetDashboardFixtures,
): Promise<void> {
  const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
  const allNull = { locationId: null, assetGroupId: null, assetId: null };
  let caught: unknown;
  let result: boolean | undefined;
  try {
    result = await svc.canManageDashboard(locationAdmin, f.eskomOrgId, allNull);
  } catch (err) {
    caught = err;
  }
  expect(
    caught,
    `an all-null scope must be refused by the ruling-2 guard, never reach resolveScopeTarget's ` +
      `throw: ${String((caught as Error)?.message ?? "")}`,
  ).toBeUndefined();
  expect(
    result,
    "location_admin must be refused an organization-wide dashboard even in its own organization",
  ).toBe(false);
}

/**
 * Anti-vacuity: every fixture id is distinct where the claims require it to be. Without this, a
 * seed in which the "non-member" asset happened to BE the member asset would make A7 assert the
 * opposite of A6 about one row, and one of the two would be silently wrong rather than red.
 */
export function assertFixturesAreDistinct(f: AssetDashboardFixtures): void {
  expect(f.eskomOrgId, "the two organizations must differ").not.toBe(f.phewbOrgId);
  expect(f.memberAssetId, "the member and non-member assets must differ").not.toBe(f.nonMemberAssetId);
  expect(
    f.assetInOwnLocationId,
    "the own-location and other-location assets must differ",
  ).not.toBe(f.assetInOtherLocationId);
  expect(f.foreignOrgAssetId, "the foreign-org asset must not be an ESKOM one").not.toBe(
    f.assetInOwnLocationId,
  );
}
