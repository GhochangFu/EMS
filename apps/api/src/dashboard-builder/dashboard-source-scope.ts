import { and, asc, eq, inArray } from "drizzle-orm";

import { dashboardWidgetSources } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";

/**
 * `F3.35` Stage C — the catalog-binding read, with its organization predicate written out.
 *
 * **The sibling of `dashboard-point-scope.ts`, and it exists for that file's reason rather than
 * for symmetry.** `getBySlug` resolves through `withOrganizationReadScope`, whose multi-
 * organization branch is `fleetDb.transaction(...)` (`tenant-read-scope.ts:151`). The fleet pool
 * role is `bms_fleet`, and `packages/db/src/roles.ts:77` gives it `BYPASSRLS` — so
 * `bms.dashboard_widget_sources`' `tenant_isolation` policy, forced though it is, **filters
 * nothing on that connection**. The predicate below is the only control there.
 *
 * Under `bms_tenant` the policy happens to mask the predicate's absence, which is exactly what
 * makes it look redundant to a reader who tests only the tenant path. It is not. Migration
 * `0054`'s header argues fail-closed from NOT NULL columns and an unset GUC; that argument holds
 * for `bms_owner` and `bms_tenant` and says nothing about the role that ignores the policy.
 *
 * **What leaks if this is deleted is smaller than the point side's leak, and still real.** A
 * point binding carries `assetId`, which a caller turns into a `telemetry.*` read one HTTP call
 * later — a cross-tenant telemetry read, as that file records. A catalog binding carries no id
 * at all: the key is a name, and `params` is gated to declare none
 * (`METRIC_CATALOG_PARAMS_WRITE`). So the leak here is *which catalog entries another tenant's
 * widget binds*, not their data. That is still another organization's dashboard configuration,
 * and the fix costs one `eq`.
 *
 * **There is no `assertBoundSourcesInOrganization` counterpart, and that is decision 4 rather
 * than an omission.** The write-side guard on the point path exists because a submitted
 * `pointId` names a row in another table that may belong to another tenant. A submitted
 * `catalogKey` names an entry in code — `metricCatalogKeySchema` is the whole check, and there
 * is no foreign row to be outside anything. The organization stamp on the row it writes is
 * supplied by the service, never by the request.
 */

/** One catalog binding, in the shape `DashboardWidgetSourceDto` needs. */
export type ResolvedWidgetSource = {
  readonly id: string;
  readonly widgetId: string;
  readonly catalogKey: string;
  readonly params: unknown;
  readonly sortOrder: number;
};

/**
 * Resolves every catalog binding for the given widget ids, with an EXPLICIT organization
 * predicate. See the file docblock for why this cannot be left to row-level security.
 *
 * No join: `dashboard_widget_sources` has one foreign key that leaves the feature
 * (`organization_id`) and one that stays inside it (`widget_id`). A catalog key is a foreign key
 * to nothing, so there is no second table to check and nothing to resolve the name against.
 */
export async function resolveWidgetSources(
  tx: BmsTx | BmsDb,
  organizationId: string,
  widgetIds: readonly string[],
): Promise<ResolvedWidgetSource[]> {
  if (widgetIds.length === 0) {
    return [];
  }
  return tx
    .select({
      id: dashboardWidgetSources.id,
      widgetId: dashboardWidgetSources.widgetId,
      catalogKey: dashboardWidgetSources.catalogKey,
      params: dashboardWidgetSources.params,
      sortOrder: dashboardWidgetSources.sortOrder,
    })
    .from(dashboardWidgetSources)
    .where(
      and(
        inArray(dashboardWidgetSources.widgetId, [...widgetIds]),
        // EXPLICIT, not delegated to RLS — see the file docblock. `bms_fleet` holds BYPASSRLS.
        eq(dashboardWidgetSources.organizationId, organizationId),
      ),
    )
    .orderBy(asc(dashboardWidgetSources.sortOrder));
}
