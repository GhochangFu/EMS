import { and, eq, inArray } from "drizzle-orm";

import { assetGroupMembers, assets } from "@bms/db";

import { expandLocationSubtrees } from "../auth/location-tree";
import type { BmsTx } from "../database/tenant-context";

/**
 * The three scope axes a dashboard — or, since `F3.73`, one of its tabs — narrows by.
 *
 * `F3.73` (ADR 0087, plan D3): a widget on a tab that binds an asset group resolves over that
 * GROUP, not over its dashboard's site. The caller builds that widget's scope as
 * `{ assetId: null, locationId: null, assetGroupId: <tab group> }` — **`locationId` must be
 * null**, because the arms below run asset, then location, then group, and a scope carrying the
 * dashboard's location would fire the location arm and ignore the group without a sound. No
 * location predicate is lost: `dashboard_tabs_asset_group_id_location_id_fkey` pins a tab's
 * group to its dashboard's site.
 */
export type DashboardAssetScope = {
  readonly locationId: string | null;
  readonly assetGroupId: string | null;
  readonly assetId: string | null;
};

/**
 * One string per distinct scope, in `resolveAssetScope`'s arm order, so two scopes that resolve
 * through the same arm to the same id share a key (a group-scoped dashboard and a tab on the same
 * group are one scope) and two that do not never collide. The catalog's dedupe key and its
 * one-resolution-per-scope memo both key on it.
 *
 * `F2.10` (ADR 0098 decision 7, B1): `subtree` marks a resolve over the location's whole
 * subtree, keyed `location-subtree:<id>` so it never shares a memo entry with the per-node
 * `location:<id>` scope of the same dashboard. It changes only the location arm.
 */
export function scopeKeyFor(
  scope: DashboardAssetScope,
  options?: { readonly subtree?: boolean },
): string {
  if (scope.assetId !== null) return `asset:${scope.assetId}`;
  if (scope.locationId !== null) {
    return options?.subtree === true
      ? `location-subtree:${scope.locationId}`
      : `location:${scope.locationId}`;
  }
  if (scope.assetGroupId !== null) return `group:${scope.assetGroupId}`;
  return "organization";
}

/**
 * The dashboard's scope and the caller's, intersected into one asset-id list. Moved here from
 * `MetricCatalogService` by `F3.73` so the catalog and the site-widgets read share one
 * definition of "the assets a scope covers".
 *
 * **Never returns `null`, and an earlier version did — that was a cross-tenant defect, not a
 * simplification** (security and correctness review, High). `readableAssetIds` is `null` only
 * for `role === "admin"`, meaning "unrestricted across every organization"; returning it
 * unchanged for a dashboard with no location and no asset group let `null` reach the
 * resolvers. The SQL entries carry `eq(<table>.organizationId, organizationId)` and survived
 * it. `assets.health.score`, delegates to `AssetHealthService`, which injects the
 * `BYPASSRLS` fleet pool and whose `assetsInScope(null, undefined)` filters on
 * `assets.active` alone — so a PHEWB dashboard answered a weighted mean over ESKOM's assets
 * too. Nothing threw, nothing logged, and the tile rendered a number.
 *
 * `access-control.service.ts:308-312` names this exact trap: `readableAssetIds` returns `null`
 * only for `admin` *today*, and Amendment 2 forbids keying anything on that coincidence. An
 * unrestricted scope must be resolved to a list, not passed through as an absence.
 *
 * So the un-narrowed case now resolves the ORGANIZATION's own active assets. The empty list
 * stays a real answer — a caller scoped to an asset group with no assets gets `[]`, which
 * every entry answers as zero rather than as a query over everything.
 *
 * `bms.asset_groups.location_id` is NOT NULL, so an asset-group scope already implies a
 * location and no two of the three scope columns can be set at once
 * (`dashboards_scope_check`; `asset_id` is the F3.2 third axis). One branch each, no
 * combination.
 *
 * `F2.10` (ADR 0098 decision 7, B1): `options.subtree` widens the LOCATION arm to the node and
 * every node under it (`expandLocationSubtrees` on `tx`, so under RLS). Only the two
 * sustainability entries pass it; every other caller — the site widgets included — omits it
 * and stays per node. The organization predicate stays either way.
 */
export async function resolveAssetScope(
  tx: BmsTx,
  organizationId: string,
  dashboard: DashboardAssetScope,
  readableAssetIds: readonly string[] | null,
  options?: { readonly subtree?: boolean },
): Promise<readonly string[]> {
  let fromDashboard: string[] | null = null;

  // `F3.2` / ADR 0067 decision 1 — the third scope axis. Found in the `E4.2` review: without
  // this arm an asset-scoped dashboard fell to the ORGANIZATION branch, and its
  // `sustainability.total` tile showed the organization's kWh under one asset's name (ADR
  // 0072 ruling 3: "over the dashboard's scope, never wider"). The organization predicate
  // is applied here too, so a mis-stamped foreign `asset_id` resolves to nothing.
  if (dashboard.assetId !== null) {
    const rows = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, dashboard.assetId), eq(assets.organizationId, organizationId)));
    fromDashboard = rows.map((row) => row.id);
  } else if (dashboard.locationId !== null) {
    const rows = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          options?.subtree === true
            ? inArray(assets.locationId, await expandLocationSubtrees(tx, [dashboard.locationId]))
            : eq(assets.locationId, dashboard.locationId),
          // EXPLICIT, never delegated to RLS. This runs on the tenant pool today, but
          // `dashboard-source-scope.ts`'s docblock records why that is not a reason to omit
          // it: the predicate is what makes the read correct on any pool.
          eq(assets.organizationId, organizationId),
        ),
      );
    fromDashboard = rows.map((row) => row.id);
  } else if (dashboard.assetGroupId !== null) {
    const rows = await tx
      .select({ id: assets.id })
      .from(assetGroupMembers)
      .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
      .where(
        and(
          eq(assetGroupMembers.assetGroupId, dashboard.assetGroupId),
          eq(assets.organizationId, organizationId),
        ),
      );
    fromDashboard = rows.map((row) => row.id);
  }

  // The dashboard narrows nothing: fall back to the ORGANIZATION, resolved as ids. This is
  // the branch that used to return `readableAssetIds` — and therefore `null` — straight
  // through to the resolvers.
  if (fromDashboard === null) {
    const rows = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.organizationId, organizationId), eq(assets.active, true)));
    fromDashboard = rows.map((row) => row.id);
  }

  if (readableAssetIds === null) return fromDashboard;

  const readable = new Set(readableAssetIds);
  return fromDashboard.filter((id) => readable.has(id));
}
