import { and, asc, eq, inArray } from "drizzle-orm";

import {
  assetGroupMembers,
  assetGroups,
  assets,
  locations,
  userAssetGroupAccess,
  userLocationAccess,
  userOrganizationAccess,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AccessibleScope, UserRole } from "@bms/shared";

import {
  noAccessScope,
  readScopeSourcesForRole,
  selectReadScopeSource,
  type ReadScopeSource,
} from "./access-scope";

/**
 * The read-scope query branches of `AccessControlService`, moved here whole
 * from `access-control.service.ts` under AGENTS.md §4.5 (the service stood at
 * 960 lines against the 1000-line cap when `F3.5a` needed to add ADR 0071
 * decision 6). A pure move: every body below is byte-identical to the method
 * it replaced apart from the signature, indentation, `this.fleetDb` →
 * `fleetDb` and `this.directOrganizationIds(…)` → `directOrganizationIds(fleetDb, …)`;
 * the service keeps a one-line delegate for
 * `directOrganizationIds` so its callers did not change.
 *
 * Every read here runs on `fleetDb` (`bms_fleet`, `BYPASSRLS`) for the reason
 * the service's file docblock gives — scope resolution runs before any tenant
 * context exists — and each is filtered by the actor's own `userId` or by ids
 * derived from that user's own grant rows, never a caller-supplied one. The
 * `WHERE` filter is the isolation control (ADR 0043 Amendment 2/3).
 *
 * `F4.161` adds the source-selection probe beside them.
 * `readScopeSourceYields` answers "does this grant source reach at least one
 * active location" with one `LIMIT 1` query, and `selectReadScopeSourceFor`
 * feeds it to `selectReadScopeSource` — the one walk both
 * `AccessControlService.scopeForUser` and `readableOrganizationIds` resolve
 * from. The probe is the same predicate as `scopeFromSource`'s "the scope has
 * a location or an asset" because every grant source derives its assets only
 * from active locations: `organization` and `location` read assets by the
 * active location ids they resolved, and `asset_group` keeps only groups whose
 * location is active before it reads their members. So `assetIds` is never
 * non-empty while `locations` is empty, and "has a location" is the whole
 * test. The probe never loads asset ids, which is what keeps it cheap.
 */

/** The part of the resolved `bms.users` row that scope resolution reads. */
export type ScopeUser = { id: string; role: UserRole };

/** Organization ids from this user's direct `user_organization_access` grants. */
export async function directOrganizationIds(fleetDb: BmsDb, userId: string): Promise<string[]> {
  // fleetDb: pre-tenant grant walk keyed by the actor's own userId (Amendment 2/3).
  const rows = await fleetDb
    .select({ id: userOrganizationAccess.organizationId })
    .from(userOrganizationAccess)
    .where(eq(userOrganizationAccess.userId, userId));
  return rows.map((row) => row.id);
}

/**
 * Resolves one grant source into a scope. `selectReadScopeSourceFor` picks the
 * source (`F4.161`); `AccessControlService.scopeForUser` then calls this once
 * on the picked source.
 */
export async function scopeFromSource(
  fleetDb: BmsDb,
  user: ScopeUser,
  source: ReadScopeSource,
): Promise<AccessibleScope> {
  if (source === "global") {
    const [locationRows, assetRows] = await Promise.all([
      fleetDb
        .select({
          id: locations.id,
          code: locations.code,
          slug: locations.slug,
          name: locations.name,
          type: locations.type,
          province: locations.province,
        })
        .from(locations)
        .where(eq(locations.active, true))
        .orderBy(asc(locations.name)),
      fleetDb.select({ id: assets.id }).from(assets),
    ]);
    return {
      kind: "global",
      locations: locationRows.map((row) => ({
        ...row,
        type: row.type as AccessibleScope["locations"][number]["type"],
      })),
      assetGroups: [],
      assetIds: assetRows.map((row) => row.id),
    };
  }

  if (source === "organization") {
    const organizationIds = await directOrganizationIds(fleetDb, user.id);
    // fleetDb: pre-tenant resolution filtered by the actor's own org grants (Amendment 2/3).
    const locationRows =
      organizationIds.length > 0
        ? await fleetDb
            .select({
              id: locations.id,
              code: locations.code,
              slug: locations.slug,
              name: locations.name,
              type: locations.type,
              province: locations.province,
            })
            .from(locations)
            .where(
              and(
                inArray(locations.organizationId, organizationIds),
                eq(locations.active, true),
              ),
            )
            .orderBy(asc(locations.name))
        : [];
    const locationIds = locationRows.map((row) => row.id);
    // fleetDb: assets gains a policy in 0047; filtered by locationIds derived
    // from the actor's own grants above (Amendment 2/3).
    const assetRows =
      locationIds.length > 0
        ? await fleetDb
            .select({ id: assets.id })
            .from(assets)
            .where(inArray(assets.locationId, locationIds))
        : [];
    return {
      kind: "location",
      locations: locationRows.map((row) => ({
        ...row,
        type: row.type as AccessibleScope["locations"][number]["type"],
      })),
      assetGroups: [],
      assetIds: assetRows.map((row) => row.id),
    };
  }

  if (source === "location") {
    // fleetDb: pre-tenant resolution keyed by the actor's own userId (Amendment 2/3).
    const locationRows = await fleetDb
      .select({
        id: locations.id,
        code: locations.code,
        slug: locations.slug,
        name: locations.name,
        type: locations.type,
        province: locations.province,
      })
      .from(userLocationAccess)
      .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
      .where(
        and(
          eq(userLocationAccess.userId, user.id),
          eq(locations.active, true),
        ),
      )
      .orderBy(asc(locations.name));
    const locationIds = locationRows.map((row) => row.id);
    // fleetDb: assets gains a policy in 0047; filtered by locationIds derived
    // from the actor's own grants above (Amendment 2/3).
    const assetRows =
      locationIds.length > 0
        ? await fleetDb
            .select({ id: assets.id })
            .from(assets)
            .where(inArray(assets.locationId, locationIds))
        : [];
    return {
      kind: "location",
      locations: locationRows.map((row) => ({
        ...row,
        type: row.type as AccessibleScope["locations"][number]["type"],
      })),
      assetGroups: [],
      assetIds: assetRows.map((row) => row.id),
    };
  }

  if (source === "asset_group") {
    // fleetDb throughout: pre-tenant resolution before any org context exists.
    // asset_groups gains a policy in 0047 and locations already carries one;
    // both reads are keyed by the actor's own userId / user-derived location
    // ids, which is the isolation control (Amendment 2/3). The join is split
    // only because the original single query mixed a userId-keyed grant walk
    // with a location filter.
    const groupRows = await fleetDb
      .select({
        id: assetGroups.id,
        locationId: assetGroups.locationId,
        code: assetGroups.code,
        name: assetGroups.name,
        // ADR 0047 Amendment 6: carried into the response so the
        // asset_group_admin authoring path's group picker can derive a
        // create body's `organizationId` without a second fetch.
        organizationId: assetGroups.organizationId,
      })
      .from(userAssetGroupAccess)
      .innerJoin(assetGroups, eq(userAssetGroupAccess.assetGroupId, assetGroups.id))
      .where(eq(userAssetGroupAccess.userId, user.id));

    const locationIds = [...new Set(groupRows.map((row) => row.locationId))];
    const locationRows =
      locationIds.length > 0
        ? await fleetDb
            .select({
              id: locations.id,
              code: locations.code,
              slug: locations.slug,
              name: locations.name,
              type: locations.type,
              province: locations.province,
            })
            .from(locations)
            .where(and(inArray(locations.id, locationIds), eq(locations.active, true)))
        : [];
    const locationById = new Map(
      locationRows.map((row) => [
        row.id,
        { ...row, type: row.type as AccessibleScope["locations"][number]["type"] },
      ]),
    );

    // Matches the original INNER JOIN + `active = true` filter: a group whose
    // location is inactive (or, in principle, gone) drops out here.
    const activeGroupRows = groupRows
      .filter((row) => locationById.has(row.locationId))
      .sort((a, b) => {
        const nameA = locationById.get(a.locationId)?.name ?? "";
        const nameB = locationById.get(b.locationId)?.name ?? "";
        return nameA === nameB ? a.name.localeCompare(b.name) : nameA.localeCompare(nameB);
      });

    const groupIds = activeGroupRows.map((row) => row.id);
    // fleetDb: assets + the asset_group_members junction gain policies in 0047;
    // filtered by groupIds derived from the actor's own grants above (Amendment 2/3).
    const assetRows =
      groupIds.length > 0
        ? await fleetDb
            .select({ id: assets.id })
            .from(assetGroupMembers)
            .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
            .where(inArray(assetGroupMembers.assetGroupId, groupIds))
        : [];

    return {
      kind: "asset_group",
      locations: [...locationById.values()],
      assetGroups: activeGroupRows.map((row) => ({
        id: row.id,
        locationId: row.locationId,
        code: row.code,
        name: row.name,
        organizationId: row.organizationId,
      })),
      assetIds: assetRows.map((row) => row.id),
    };
  }

  return noAccessScope();
}

/**
 * Whether `source` reaches at least one active location for this user
 * (`F4.161`). One `LIMIT 1` query per probed source; see the file docblock for
 * why this equals `scopeFromSource`'s "the scope has a location or an asset".
 */
export async function readScopeSourceYields(
  fleetDb: BmsDb,
  user: ScopeUser,
  source: ReadScopeSource,
): Promise<boolean> {
  if (source === "global") {
    // Unreachable: `global` is only ever `admin`'s sole source, and
    // `selectReadScopeSource` never probes a sole source. `true` states that
    // the walk would pick it.
    return true;
  }

  if (source === "organization") {
    // fleetDb: pre-tenant grant walk keyed by the actor's own userId (Amendment 2/3).
    const rows = await fleetDb
      .select({ id: locations.id })
      .from(userOrganizationAccess)
      .innerJoin(locations, eq(userOrganizationAccess.organizationId, locations.organizationId))
      .where(and(eq(userOrganizationAccess.userId, user.id), eq(locations.active, true)))
      .limit(1);
    return rows.length > 0;
  }

  if (source === "location") {
    // fleetDb: pre-tenant grant walk keyed by the actor's own userId (Amendment 2/3).
    const rows = await fleetDb
      .select({ id: locations.id })
      .from(userLocationAccess)
      .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
      .where(and(eq(userLocationAccess.userId, user.id), eq(locations.active, true)))
      .limit(1);
    return rows.length > 0;
  }

  if (source === "asset_group") {
    // fleetDb: pre-tenant grant walk keyed by the actor's own userId (Amendment 2/3).
    // A group yields through its location alone — an empty group under an
    // active location yields, as it does in `scopeFromSource` — so
    // `asset_group_members` is never read here.
    const rows = await fleetDb
      .select({ id: locations.id })
      .from(userAssetGroupAccess)
      .innerJoin(assetGroups, eq(userAssetGroupAccess.assetGroupId, assetGroups.id))
      .innerJoin(locations, eq(assetGroups.locationId, locations.id))
      .where(and(eq(userAssetGroupAccess.userId, user.id), eq(locations.active, true)))
      .limit(1);
    return rows.length > 0;
  }

  return false;
}

/**
 * The grant source this user's read scope resolves from (`F4.161`): the one
 * selection both `AccessControlService.scopeForUser` and
 * `readableOrganizationIds` use, so the two cannot disagree on the source.
 */
export function selectReadScopeSourceFor(
  fleetDb: BmsDb,
  user: ScopeUser,
): Promise<ReadScopeSource> {
  return selectReadScopeSource(readScopeSourcesForRole(user.role), (source) =>
    readScopeSourceYields(fleetDb, user, source),
  );
}
