import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import {
  alarms,
  assetGroupMembers,
  assets,
  dashboards,
  dashboardWidgets,
  workOrders,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MAX_DATASET_ROWS,
  METRIC_CATALOG,
  type DashboardCatalogValuesResponse,
  type MetricCatalogKey,
  type MetricCatalogValueDto,
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { resolveWidgetSources } from "./dashboard-source-scope";

/**
 * What a resolver may reach for beyond the transaction.
 *
 * Passed explicitly rather than bound as `this`. Four of the five entries need nothing here, and
 * a `this`-bound map would have to be cast to reach the service's injected dependency — a cast
 * on the one path that calls another module's service.
 */
type ResolverDeps = { readonly health: AssetHealthService };

/** How the catalog's five entries resolve: four are SQL here, one delegates. */
type Resolver = (
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  deps: ResolverDeps,
) => Promise<MetricCatalogValueDto>;

/**
 * `F3.35` Stage C — resolving a dashboard's named catalog bindings (ADR 0048 decisions 1 and 2).
 *
 * **Four entries are SQL written here; one is a service call, and the asymmetry is deliberate.**
 * `assets.health.score` delegates to `AssetHealthService.summary(...).score` — `E1.3` and ADR
 * 0050 own the roll-up, its windowing, its band model and the `bms.automation_rules`-derived
 * definition of "in range". A fifth query here would be a second implementation of a formula the
 * client supplied once, drifting the moment either side changes. **Do not add a SQL branch for
 * health.** If another entry ever needs a computation a service already owns, delegate the same
 * way rather than matching the shape of its four neighbours.
 *
 * **SCOPE IS THE CORRECTNESS RISK OF THIS FILE, and it fails silently.** A dashboard may be
 * scoped to a location or an asset group (`bms.dashboards.location_id` / `asset_group_id`), and
 * `bms.dashboard_widget_sources`' `tenant_isolation` policy gives ORGANIZATION isolation and no
 * dashboard scope whatsoever — that gap is recorded in `packages/db/src/schema/dashboard-schema.ts`.
 * A site dashboard whose tile reads `alarms.active.count` and answers with the organization's
 * count throws nothing, logs nothing, and renders a plausible number an operator reads as their
 * site's. Every entry therefore takes `scope` and every query applies it.
 *
 * **The caller's scope INTERSECTS the dashboard's; it never replaces it.** An asset-scoped user
 * reading an organization-wide dashboard sees their assets, not the organization's. Both
 * narrowings are computed into one `assetIds` list before any entry runs, so no entry can forget
 * one of them.
 *
 * **`params` is read by nothing here, and that is Unit 3's decision arriving intact.**
 * `METRIC_CATALOG_PARAMS_WRITE` declares no fields for any entry, so there is no parameter to
 * read — a dataset's row cap comes from `MAX_DATASET_ROWS`, not from a request. When an entry
 * first needs a filter, it is a field on that entry's write schema (and the containment test
 * still passing), never a query-string parameter.
 */
@Injectable()
export class MetricCatalogService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly health: AssetHealthService,
  ) {}

  /**
   * The authorized entry point. `resolveForDashboard` below is the unauthorized core, which is
   * what the integration spec drives directly.
   *
   * **Two independent narrowings, and neither is the other's substitute.**
   * `readableOrganizationIds` decides whether this caller may see this dashboard at all — a
   * dashboard outside it is a 404 rather than a 403, matching `getBySlug`, because a 403 would
   * confirm the id exists. `readableAssetIds` then decides which assets count toward every
   * entry, and it intersects with the dashboard's own scope rather than replacing it.
   *
   * The by-id lookup runs on `fleetDb` for the reason `fetchRowForWrite` does: the caller's
   * organization is not known until the row is read. `bms_fleet` holds `BYPASSRLS`, so the
   * `inArray` below is the containment, not the policy — and it is written explicitly for that
   * reason.
   */
  async catalogValues(jwt: JwtPayload, dashboardId: string): Promise<DashboardCatalogValuesResponse> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    const [row] = await this.fleetDb
      .select({ id: dashboards.id, organizationId: dashboards.organizationId })
      .from(dashboards)
      .where(
        orgIds === null
          ? eq(dashboards.id, dashboardId)
          : and(eq(dashboards.id, dashboardId), inArray(dashboards.organizationId, orgIds)),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Dashboard not found");
    }

    return this.resolveForDashboard(
      row.organizationId,
      dashboardId,
      await this.accessControl.readableAssetIds(jwt),
    );
  }

  /**
   * Resolves every catalog binding on one dashboard.
   *
   * `readableAssetIds` is the caller's own scope — `null` means "every asset in the
   * organization", matching `AccessControlService.readableAssetIds`' own convention.
   */
  async resolveForDashboard(
    organizationId: string,
    dashboardId: string,
    readableAssetIds: readonly string[] | null,
  ): Promise<DashboardCatalogValuesResponse> {
    return withTenant(this.tenantDb, organizationId, async (tx) => {
      const [dashboard] = await tx
        .select()
        .from(dashboards)
        .where(eq(dashboards.id, dashboardId))
        .limit(1);
      if (!dashboard) {
        return { values: [], resolvedAt: new Date().toISOString() };
      }

      const widgetRows = await tx
        .select({ id: dashboardWidgets.id })
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.dashboardId, dashboardId));
      const sources = await resolveWidgetSources(
        tx,
        organizationId,
        widgetRows.map((widget) => widget.id),
      );
      if (sources.length === 0) {
        return { values: [], resolvedAt: new Date().toISOString() };
      }

      const scope = await this.resolveAssetScope(tx, organizationId, dashboard, readableAssetIds);

      // One resolve per DISTINCT key, not per binding. Two tiles binding
      // `alarms.active.count` on one dashboard are one query, and the parameters that would
      // make them differ do not exist yet.
      const distinct = [...new Set(sources.map((source) => source.catalogKey))];
      const byKey = new Map<string, MetricCatalogValueDto>();
      for (const key of distinct) {
        const resolver = RESOLVERS[key as MetricCatalogKey];
        if (resolver === undefined) continue;
        byKey.set(key, await resolver(tx, organizationId, scope, { health: this.health }));
      }

      return {
        values: sources.flatMap((source) => {
          const resolved = byKey.get(source.catalogKey);
          // `widgetId` and `catalogKey` travel beside `sourceId` because they are the pair the
          // viewer keys on — `sourceId` is regenerated by every widget save. The contract's own
          // docblock carries the failure that taught us.
          return resolved === undefined
            ? []
            : [
                {
                  sourceId: source.id,
                  widgetId: source.widgetId,
                  catalogKey: source.catalogKey as MetricCatalogKey,
                  resolved,
                },
              ];
        }),
        resolvedAt: new Date().toISOString(),
      };
    });
  }

  /**
   * The dashboard's scope and the caller's, intersected into one asset-id list.
   *
   * **Never returns `null`, and an earlier version did — that was a cross-tenant defect, not a
   * simplification** (security and correctness review, High). `readableAssetIds` is `null` only
   * for `role === "admin"`, meaning "unrestricted across every organization"; returning it
   * unchanged for a dashboard with no location and no asset group let `null` reach the
   * resolvers. Four of the five carry `eq(<table>.organizationId, organizationId)` and survived
   * it. The fifth, `assets.health.score`, delegates to `AssetHealthService`, which injects the
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
   * location and the two columns can never both be set (`dashboards_scope_check`). One branch
   * each, no combination.
   */
  private async resolveAssetScope(
    tx: BmsTx,
    organizationId: string,
    dashboard: { locationId: string | null; assetGroupId: string | null },
    readableAssetIds: readonly string[] | null,
  ): Promise<readonly string[]> {
    let fromDashboard: string[] | null = null;

    if (dashboard.locationId !== null) {
      const rows = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.locationId, dashboard.locationId),
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
}

/**
 * An empty scope is a real state — a caller scoped to an asset group holding no assets — and
 * every entry below routes it to a zero answer before building SQL.
 *
 * **This comment used to claim `inArray(x, [])` emits `in ()`, a Postgres syntax error. That is
 * false at the pinned version** (security review), and it was copied here from
 * `AssetHealthService.summary`, which carried the same wrong reason. Drizzle 0.38.4 returns
 * ``sql`false` `` for an empty array. So these guards save a round trip and return the right
 * SHAPE — a zero count, an empty dataset — rather than preventing a crash. Keep them; do not
 * keep the reason.
 */
function scopeIsEmpty(scope: readonly string[]): boolean {
  return scope.length === 0;
}

/** The rows an entry may see, as a drizzle predicate over an `asset_id` column. */
function scopedTo(column: Parameters<typeof inArray>[0], scope: readonly string[]) {
  return inArray(column, [...scope]);
}

const metricValue = (
  key: MetricCatalogKey,
  value: number | null,
  unit: string | null,
): MetricCatalogValueDto => ({ shape: "metric", key, value, unit });

const datasetValue = (
  key: MetricCatalogKey,
  rows: Record<string, string | number | boolean | null>[],
  truncated: boolean,
): MetricCatalogValueDto => {
  const meta = METRIC_CATALOG[key];
  return {
    shape: "dataset",
    key,
    // The DECLARED columns, always, whatever the rows happen to carry. A renderer projecting on
    // a key that some rows have and others do not is the failure this avoids.
    columns: meta.shape === "dataset" ? [...meta.columns] : [],
    rows,
    truncated,
  };
};

/**
 * An active alarm is one that has not been acknowledged.
 *
 * `bms.alarms` carries no cleared/resolved column — `acknowledged_at IS NULL` is the whole
 * definition, and `alarms.service.ts:215` uses the same predicate to acknowledge one. Stated
 * here rather than assumed, because "active" reads like it should have a lifecycle behind it.
 */
const activeAlarmWhere = (organizationId: string, scope: readonly string[]) =>
  and(
    eq(alarms.organizationId, organizationId),
    isNull(alarms.acknowledgedAt),
    scopedTo(alarms.assetId, scope),
  );

/**
 * An open work order is one that is neither resolved nor closed.
 *
 * `workOrderStatusSchema` is `open | assigned | in_progress | resolved | closed`, so this is
 * equivalent to naming the first three TODAY. It is written as the negative deliberately: this
 * number is outstanding work, and a status added later should default to counted rather than to
 * hidden. Over-reporting outstanding work is visible; under-reporting it is not.
 */
const openWorkOrderWhere = (organizationId: string, scope: readonly string[]) =>
  and(
    eq(workOrders.organizationId, organizationId),
    notInArray(workOrders.status, ["resolved", "closed"]),
    scopedTo(workOrders.assetId, scope),
  );

const RESOLVERS: Record<MetricCatalogKey, Resolver> = {
  "alarms.active.count": async function (tx, organizationId, scope) {
    if (scopeIsEmpty(scope)) return metricValue("alarms.active.count", 0, null);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(alarms)
      .where(activeAlarmWhere(organizationId, scope));
    return metricValue("alarms.active.count", row?.n ?? 0, null);
  },

  "alarms.active": async function (tx, organizationId, scope) {
    if (scopeIsEmpty(scope)) return datasetValue("alarms.active", [], false);
    // `MAX_DATASET_ROWS + 1` so `truncated` is a fact rather than a guess: a separate count
    // would be a second query and could disagree with the rows under concurrent writes.
    const rows = await tx
      .select({
        assetCode: assets.code,
        assetName: assets.name,
        severity: alarms.severity,
        message: alarms.message,
        raisedAt: alarms.raisedAt,
      })
      .from(alarms)
      // The JOINED table carries its own organization predicate, not only the driving one
      // (security review, Low). `0047`'s policies on `bms.alarms` and `bms.work_orders` check
      // the row's own column with no parent-asset `EXISTS` leg, so a child row's `asset_id`
      // need not belong to its `organization_id` — `health-rollup.integration.spec.ts` states
      // that outright. `scope` is organization-bounded, which already excludes a foreign asset;
      // this predicate is what makes the join correct without depending on that.
      .innerJoin(
        assets,
        and(eq(alarms.assetId, assets.id), eq(assets.organizationId, organizationId)),
      )
      .where(activeAlarmWhere(organizationId, scope))
      .orderBy(desc(alarms.raisedAt))
      .limit(MAX_DATASET_ROWS + 1);

    const truncated = rows.length > MAX_DATASET_ROWS;
    return datasetValue(
      "alarms.active",
      rows.slice(0, MAX_DATASET_ROWS).map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        severity: row.severity,
        message: row.message,
        // ISO, not a `Date`: the contract's cell union is string/number/boolean/null, and a
        // `Date` would serialise to a string anyway — through `JSON.stringify` rather than
        // through anything this file states.
        raisedAt: row.raisedAt.toISOString(),
      })),
      truncated,
    );
  },

  "workorders.open.count": async function (tx, organizationId, scope) {
    if (scopeIsEmpty(scope)) return metricValue("workorders.open.count", 0, null);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(openWorkOrderWhere(organizationId, scope));
    return metricValue("workorders.open.count", row?.n ?? 0, null);
  },

  "workorders.open": async function (tx, organizationId, scope) {
    if (scopeIsEmpty(scope)) return datasetValue("workorders.open", [], false);
    const rows = await tx
      .select({
        assetCode: assets.code,
        assetName: assets.name,
        status: workOrders.status,
        priority: workOrders.priority,
        title: workOrders.title,
        dueAt: workOrders.dueAt,
      })
      .from(workOrders)
      // The organization predicate on the joined table, for the reason `alarms.active` states.
      .innerJoin(
        assets,
        and(eq(workOrders.assetId, assets.id), eq(assets.organizationId, organizationId)),
      )
      .where(openWorkOrderWhere(organizationId, scope))
      .orderBy(desc(workOrders.createdAt))
      .limit(MAX_DATASET_ROWS + 1);

    const truncated = rows.length > MAX_DATASET_ROWS;
    return datasetValue(
      "workorders.open",
      rows.slice(0, MAX_DATASET_ROWS).map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        status: row.status,
        priority: row.priority,
        title: row.title,
        // Nullable in the column and nullable in the cell union — a work order with no due date
        // is ordinary, and `null` is the honest cell rather than an empty string.
        dueAt: row.dueAt === null ? null : row.dueAt.toISOString(),
      })),
      truncated,
    );
  },

  /**
   * THE ONE THAT DELEGATES. `E1.3` owns the roll-up (ADR 0050); this hands it the same scope
   * every other entry uses and returns its weighted mean.
   *
   * `null` is a correct answer, not a failure: `E1.3` excludes a tag with no published threshold
   * rule rather than scoring it 1.0, and against seeded data nothing is scored at all — `F4.69`.
   * The contract's metric arm is `z.number().nullable()` for exactly this.
   */
  "assets.health.score": async (_tx, _organizationId, scope, deps) => {
    // `locationId` is left `undefined` on purpose: the dashboard's location scope is ALREADY
    // resolved into `scope` as asset ids, and passing it again would narrow twice — once
    // correctly, once against a filter `summary` applies on top of the ids it was given.
    // `windowMinutes: 60` matches the tile's default refresh horizon; ADR 0048 leaves the
    // catalog's cadence to the viewer, and an entry that took a window would need a `params`
    // field and its containment test.
    const summary = await deps.health.summary(
      [...scope],
      undefined,
      60,
      new Date(),
    );
    return metricValue("assets.health.score", summary.score, null);
  },
};
