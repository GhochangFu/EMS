import { expect } from "vitest";
import type pg from "pg";

import type { AccessControlService } from "./access-control.service";
import { jwtFor, SEEDED } from "./access-control.integration.spec";
import { resolveSeededAssetByCode } from "../testing/integration-fixtures";

/**
 * `F3.2` Task 4 — `canManageDashboard`'s ASSET arm (ADR 0067 decision 2, plan D9).
 *
 * A separate file from `access-control.integration.spec.ts` for a mechanical reason: that file
 * is at 975 of the 1000-line whole-file cap the pre-commit hook enforces, so the ten claims
 * below could not live there. The two share `jwtFor`/`SEEDED` rather than restating them.
 *
 * **Every id is read from the database, never hardcoded, and every ASSET is named rather than
 * positioned.** A uuid literal in a test stops existing the first time the seed changes; an
 * `ORDER BY … LIMIT 1` on `bms.assets` is worse, because it silently adopts whichever row
 * currently sorts first — another suite's committed fixture as often as the seed — and that
 * suite's `afterAll` then deletes the row mid-test. `tests/integration-fixture-isolation.test.ts`
 * gates exactly this, and it flagged four reads in the first draft of this file. Each is now
 * `resolveSeededAssetByCode()` against a code `packages/db/src/eskom-assets-seed.ts` or
 * `phe-pilot-seed.ts` writes by name.
 *
 * Naming a row is not the same as knowing what it is, so every named asset is then verified —
 * id-scoped — against the property the claim it serves actually needs: the location it sits at,
 * the organization it belongs to, and its membership or non-membership of the group under test.
 * A seed that moved `CR-HVAC-1` to another site must fail here with a sentence saying so, not
 * turn A3 into a claim about nothing.
 *
 * Read-only apart from `assertA7bGroupInAnotherOrganizationDoesNotAuthorize`, which creates one
 * cross-organization group and deletes it in a `finally`.
 */

/**
 * `wc-admin@bms.local`'s own site: the Western Cape control room. All three are written by
 * `packages/db/src/eskom-assets-seed.ts` under those exact codes.
 *
 * `CR-HVAC-1` is an `hvac` group member (`asset-groups-seed.ts` maps the `hvac` domain to that
 * group); `CR-UPS-1` is not — it is an `ups-battery` member, which is a group
 * `wc-hvac-admin@bms.local` does not hold. Both facts are re-checked below rather than trusted.
 */
const MEMBER_ASSET_CODE = "CR-HVAC-1";
const OWN_LOCATION_ASSET_CODE = "CR-HVAC-2";
const NON_MEMBER_ASSET_CODE = "CR-UPS-1";
/** The same ESKOM organization, a different site (`RSMOC-EC`) — the A4 target. */
const OTHER_LOCATION_ASSET_CODE = "EC-CR-HVAC-1";
/** PHEWB, seeded by `seedPheCatalog` from the committed `phe-catalog.json`. */
const FOREIGN_ORG_ASSET_CODE = "PHE-MFM-000000001";

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

/**
 * Verifies what a NAMED asset actually is, id-scoped.
 *
 * Naming the row closes the "whose fixture did I just adopt" race; it does not say the row
 * still sits where the claim needs it. A seed that moves `CR-HVAC-1` to another site would
 * otherwise turn A3 from "a location admin manages an asset at its own location" into a claim
 * about a site it does not hold — green, and about nothing. The read is `WHERE id = $1`, so it
 * is not a positional read of `bms.assets` at all.
 */
async function assertAssetSitsAt(
  pool: pg.Pool,
  assetId: string,
  code: string,
  expected: { organizationId: string; locationId?: string; notLocationId?: string },
): Promise<void> {
  const row = await one<{ organization_id: string; location_id: string }>(
    pool,
    `SELECT organization_id, location_id FROM bms.assets WHERE id = $1`,
    [assetId],
    `the seeded asset ${code}`,
  );
  if (row.organization_id !== expected.organizationId) {
    throw new Error(
      `F3.2: the seeded asset ${code} is in organization ${row.organization_id}, but this ` +
        `fixture needs it in ${expected.organizationId}. The seed moved it — pick another ` +
        "named code; do not widen this back to a positional read.",
    );
  }
  if (expected.locationId !== undefined && row.location_id !== expected.locationId) {
    throw new Error(
      `F3.2: the seeded asset ${code} is at location ${row.location_id}, but this fixture ` +
        `needs it at ${expected.locationId} (${SEEDED.locationAdmin}'s own site).`,
    );
  }
  if (expected.notLocationId !== undefined && row.location_id === expected.notLocationId) {
    throw new Error(
      `F3.2: the seeded asset ${code} is at ${row.location_id}, the very location this fixture ` +
        "needs it NOT to be at — the A4 case would assert nothing.",
    );
  }
}

/**
 * Verifies that a named asset is (or is not) a member of ANY group the asset-group admin holds.
 *
 * Against the actor's whole grant set, not against one group id: `canManageDashboard`'s
 * membership join is keyed on `userAssetGroupAccess.userId`, so a "non-member" that happens to
 * sit in a SECOND group the same user holds would make A7 assert the opposite of what it says.
 */
async function assertGroupMembership(
  pool: pg.Pool,
  assetId: string,
  code: string,
  expected: boolean,
): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM bms.asset_group_members m
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = m.asset_group_id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE m.asset_id = $1 AND u.email = $2`,
    [assetId, SEEDED.assetGroupAdmin],
  );
  const isMember = Number(rows[0]?.n ?? "0") > 0;
  if (isMember !== expected) {
    throw new Error(
      `F3.2: the seeded asset ${code} is ${isMember ? "" : "not "}a member of a group ` +
        `${SEEDED.assetGroupAdmin} holds, but this fixture needs it ${expected ? "" : "not "}` +
        "to be. The seed's group mapping changed — pick another named code.",
    );
  }
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
  const ownLocationAssetId = await resolveSeededAssetByCode(pool, OWN_LOCATION_ASSET_CODE);
  await assertAssetSitsAt(pool, ownLocationAssetId, OWN_LOCATION_ASSET_CODE, {
    organizationId: eskom.id,
    locationId: location.id,
  });
  const otherLocationAssetId = await resolveSeededAssetByCode(pool, OTHER_LOCATION_ASSET_CODE);
  await assertAssetSitsAt(pool, otherLocationAssetId, OTHER_LOCATION_ASSET_CODE, {
    organizationId: eskom.id,
    notLocationId: location.id,
  });
  const foreignAssetId = await resolveSeededAssetByCode(pool, FOREIGN_ORG_ASSET_CODE);
  await assertAssetSitsAt(pool, foreignAssetId, FOREIGN_ORG_ASSET_CODE, {
    organizationId: phewb.id,
  });
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
  const memberAssetId = await resolveSeededAssetByCode(pool, MEMBER_ASSET_CODE);
  await assertAssetSitsAt(pool, memberAssetId, MEMBER_ASSET_CODE, {
    organizationId: group.organization_id,
  });
  await assertGroupMembership(pool, memberAssetId, MEMBER_ASSET_CODE, true);
  const nonMemberAssetId = await resolveSeededAssetByCode(pool, NON_MEMBER_ASSET_CODE);
  await assertAssetSitsAt(pool, nonMemberAssetId, NON_MEMBER_ASSET_CODE, {
    organizationId: group.organization_id,
  });
  await assertGroupMembership(pool, nonMemberAssetId, NON_MEMBER_ASSET_CODE, false);

  return {
    eskomOrgId: eskom.id,
    phewbOrgId: phewb.id,
    locationAdminLocationId: location.id,
    assetInOwnLocationId: ownLocationAssetId,
    assetInOtherLocationId: otherLocationAssetId,
    foreignOrgAssetId: foreignAssetId,
    assetGroupAdminGroupId: group.id,
    memberAssetId,
    nonMemberAssetId,
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

/**
 * A11 (review, security Low) — the asset arm's LOCATION must be proved to belong to the
 * organization, not merely to be one the actor holds.
 *
 * `assetBelongsToOrganization` proves the ASSET's organization and hands back
 * `assets.location_id`; `canManageLocation` then answers "may this user manage that location",
 * which for a `location_admin` is a walk of its own `user_location_access` rows with **no
 * organization predicate at all** (`writableLocationIds`). Neither half asks whether the
 * location belongs to the organization the dashboard is stamped with, so one inconsistent
 * asset row — organization B, sitting at a location of organization A — turns a location admin
 * of A into an authorized writer of B's asset-scoped dashboards. This is A5's shape one column
 * over: A5 is refused by the organization check before the location check is ever reached,
 * which is why it left this hole green.
 *
 * **The database permits the inconsistent row, and that was the open question.** Checked on
 * the running stack: `bms.assets` carries `assets_location_id_locations_id_fk` to
 * `bms.locations(id)` and `assets_organization_id_fkey` to `bms.organizations(id)`, but no
 * CHECK, no composite foreign key and no trigger relates the two — so the row inserts, and the
 * refusal has to come from this service.
 *
 * One asset, inserted on the fleet pool and deleted in a `finally` (the A7b precedent). Nothing
 * seeded is mutated: a grant row added to `wc-admin@bms.local` would be read by other suites'
 * unordered `user_location_access` fixtures in the same parallel run.
 */
export async function assertA11InconsistentAssetLocationDoesNotAuthorize(
  svc: AccessControlService,
  pool: pg.Pool,
  f: AssetDashboardFixtures,
): Promise<void> {
  const code = `f32-a11-${Date.now()}`;
  const asset = await one<{ id: string }>(
    pool,
    `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
     VALUES ($1, $2, $3, 'F3.2 A11 inconsistent-location proof', 'F3.2 A11', 'hvac')
     RETURNING id`,
    [f.phewbOrgId, f.locationAdminLocationId, code],
    "the inconsistent fixture asset (organization B, located in organization A)",
  );
  try {
    const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
    expect(
      await svc.canManageDashboard(locationAdmin, f.phewbOrgId, assetScope(asset.id)),
      "an asset of ANOTHER organization that happens to sit at this location admin's own " +
        "location must not authorize that organization's asset-scoped dashboard — " +
        "canManageLocation never asks which organization the location belongs to, so the " +
        "locationBelongsToOrganization check is the only thing that refuses it",
    ).toBe(false);
  } finally {
    await pool.query(`DELETE FROM bms.assets WHERE id = $1`, [asset.id]);
  }
}
