import type {
  BuiltinSiteViewKey,
  ResolvedSiteControlRoomViewDto,
  SiteControlRoomViewNotice,
} from "@bms/shared";

/**
 * `F3.67` / ADR 0076 decision 5 — the fail-safe resolver every later row
 * consumes (`F3.66`, `F3.68`, `F3.69`, `F3.70`). Written once, unit-tested
 * once (`site-control-room-view.pure.spec.ts`), served once by
 * `SiteControlRoomViewService.resolve`.
 *
 * Pure: no database, no Nest. The service reads the stored row, the chosen
 * dashboard and the site's asset-group ids on the fleet pool and hands them in.
 */

/** The scope columns of one `bms.dashboards` row — what eligibility reads. */
export type DashboardScopeRow = {
  id: string;
  slug: string;
  organizationId: string;
  locationId: string | null;
  assetGroupId: string | null;
  assetId: string | null;
};

/**
 * One stored `bms.site_control_room_views` row. `kind` and `builtinKey` are
 * `string`, not the contract enums: they are stored data, and the resolver
 * narrows them itself rather than trusting (or `.parse`-ing) them — a value the
 * code does not know answers the generated view, never a 500 (F4.108).
 */
export type SiteViewRow = {
  organizationId: string;
  kind: string;
  dashboardId: string | null;
  builtinKey: string | null;
};

/**
 * Whether a dashboard may be a site's Control Room view: scoped to the site
 * itself, or to one of the site's asset groups.
 *
 * **An `asset`-scoped dashboard is never eligible (plan D6)**, and that holds by
 * construction rather than by a third branch: `dashboards_scope_check` allows
 * at most one of `location_id`, `asset_group_id` and `asset_id`, so an
 * asset-scoped dashboard has neither of the two columns this reads. An
 * organization-wide dashboard (no scope column) is not eligible either.
 *
 * The organization is not compared here. The write path reads the dashboard
 * with `organization_id = <the site's organization>` in its `WHERE`, and
 * {@link resolveSiteControlRoomView} compares it before it calls this.
 */
export function dashboardIsScopedToSite(
  d: DashboardScopeRow,
  locationId: string,
  siteGroupIds: ReadonlySet<string>,
): boolean {
  if (d.locationId === locationId) {
    return true;
  }
  return d.assetGroupId !== null && siteGroupIds.has(d.assetGroupId);
}

function generated(
  locationId: string,
  notice: SiteControlRoomViewNotice | null,
): ResolvedSiteControlRoomViewDto {
  return {
    locationId,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice,
  };
}

/**
 * The effective view for one site (ADR 0076 decision 5, plan D5).
 *
 * - No row, or a `generated` row → `generated`, no notice.
 * - `dashboard` whose dashboard is gone (`dashboard_id` set NULL by the FK, or
 *   the read found nothing) → `generated` + `dashboard_removed`.
 * - `dashboard` whose stored row or dashboard is not in the SITE's
 *   organization (`site.organizationId`, read from `bms.locations` — never
 *   one taken from the row or the dashboard, which could agree with each other
 *   and both be wrong), or whose dashboard is no longer scoped to the site →
 *   `generated` + `dashboard_out_of_scope`. Scope is re-checked here, at read
 *   time, because a dashboard can be re-scoped after it was chosen.
 * - `builtin` whose key is not in `knownBuiltinKeys` → `generated` +
 *   `builtin_unknown`. The list is a parameter, not read from the contract
 *   here, so a key the database holds and this build does not ship fails safe.
 * - Any other stored `kind` → `generated`, no notice (the CHECK forbids it; the
 *   resolver still does not trust it).
 */
export function resolveSiteControlRoomView(
  site: { locationId: string; organizationId: string },
  row: SiteViewRow | null,
  dashboard: DashboardScopeRow | null,
  siteGroupIds: ReadonlySet<string>,
  knownBuiltinKeys: readonly BuiltinSiteViewKey[],
): ResolvedSiteControlRoomViewDto {
  const { locationId } = site;
  if (row === null) {
    return generated(locationId, null);
  }

  if (row.kind === "dashboard") {
    if (row.dashboardId === null || dashboard === null) {
      return generated(locationId, "dashboard_removed");
    }
    if (
      row.organizationId !== site.organizationId ||
      dashboard.organizationId !== site.organizationId ||
      !dashboardIsScopedToSite(dashboard, locationId, siteGroupIds)
    ) {
      return generated(locationId, "dashboard_out_of_scope");
    }
    return {
      locationId,
      kind: "dashboard",
      dashboardId: dashboard.id,
      dashboardSlug: dashboard.slug,
      builtinKey: null,
      notice: null,
    };
  }

  if (row.kind === "builtin") {
    const key = knownBuiltinKeys.find((known) => known === row.builtinKey);
    if (key === undefined) {
      return generated(locationId, "builtin_unknown");
    }
    return {
      locationId,
      kind: "builtin",
      dashboardId: null,
      dashboardSlug: null,
      builtinKey: key,
      notice: null,
    };
  }

  return generated(locationId, null);
}
