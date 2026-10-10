import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";

import {
  alarms,
  assetGroups,
  assets,
  dashboards,
  dashboardTabs,
  dashboardWidgets,
  locations,
  workOrders,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MAX_DATASET_ROWS,
  METRIC_CATALOG,
  type DashboardCatalogValuesResponse,
  type MetricCatalogKey,
  type MetricCatalogValueDto,
  type SustainabilityAggregate,
  type WaterBalancePeriod,
  METRIC_CATALOG_PARAMS_WRITE,
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { LIVE_ASSETS_CTE_SQL } from "../telemetry/telemetry-freshness";
import {
  resolveAssetScope,
  scopeKeyFor,
  type DashboardAssetScope,
} from "./dashboard-scope-assets";
import { resolveWidgetSources } from "./dashboard-source-scope";
import { groupLocationsAtDepth } from "./sustainability-grouping";
import {
  capRows,
  isMoneyPointKey,
  readBalanceLocations,
  readOrganizationCurrency,
  readPointKeyUnit,
  readRollupRows,
  rollup,
  rollupCurrency,
  type RollupRow,
} from "./sustainability-rollup";
import { waterBalanceRow } from "./water-balance";

/**
 * What a resolver may reach for beyond the transaction.
 *
 * Passed explicitly rather than bound as `this`. Eight of the ten entries need nothing here
 * (`assets.health.score` reads `health`; `sustainability.by_location` reads
 * `readableLocationIds` since `F2.10`), and a `this`-bound map would have to be cast to reach
 * the service's injected dependency — a cast on the one path that calls another module's service.
 */
type ResolverDeps = {
  readonly health: AssetHealthService;
  /**
   * `F2.10` — the reader's location ids, `null` when unrestricted. Only `by_location`'s
   * `groupDepth` reads it: a group label is never an ancestor the reader cannot read (A6).
   */
  readonly readableLocationIds: ReadonlySet<string> | null;
  /**
   * `F2.10` owner rulings P1 and P4 — the dashboard's own location node, for every widget on
   * it (a group tab's widget included): its `locationId`, or for a group-scoped dashboard the
   * GROUP's `location_id` read from the database; `null` for an asset- or organization-scoped
   * dashboard. `by_location`'s group never goes above it.
   */
  readonly scopeLocationId: string | null;
};

/**
 * How the catalog's entries resolve: six are SQL here (the four Stage C reads and the two
 * `F3.73` asset reads), one delegates, two roll up a point key, and one (`water.balance`,
 * `E4.3`) folds three role-filtered roll-ups into a row per site.
 *
 * `params` is the binding's stored `params` AFTER `METRIC_CATALOG_PARAMS_WRITE[key]` has
 * parsed it (`E4.2`): `{}` for the five Stage C entries and the two `F3.73` asset entries,
 * `{ pointKey, aggregate }` and an
 * optional `balanceRole` (`E4.3`) for the two sustainability entries — plus an optional
 * `groupDepth` on `by_location` since `F2.10` — and `{ period }` for
 * `water.balance`. Positional and required
 * rather than optional, so a resolver that reads a field cannot compile against a call that
 * never passes one.
 */
type Resolver = (
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  deps: ResolverDeps,
  params: unknown,
) => Promise<MetricCatalogValueDto>;

/** The parsed shape of a sustainability binding's params — what `METRIC_CATALOG_PARAMS_WRITE`
 * guarantees before a resolver runs, spelled once for the two entries that read it. */
type SustainabilityParams = {
  readonly pointKey: string;
  readonly aggregate: SustainabilityAggregate;
  /** `E4.3` / ADR 0073 decision 2 — narrows the carrying set to one water balance role. */
  readonly balanceRole?: string;
  /** `F2.10` (ADR 0098 Amendment 1, C) — `by_location` only: group rows by the ancestor at
   * this depth (root = 1). The write schema admits it on no other entry. */
  readonly groupDepth?: number;
};

/** `E4.3` — the parsed shape of a `water.balance` binding's params. */
type WaterBalanceParams = { readonly period: WaterBalancePeriod };

/**
 * `F3.35` Stage C — resolving a dashboard's named catalog bindings (ADR 0048 decisions 1 and 2).
 *
 * **Nine entries are SQL written here (four Stage C reads, the two `F3.73` asset reads, the two
 * `E4.2` roll-ups and the `E4.3` water balance, whose statements live in
 * `sustainability-rollup.ts`); one is a service
 * call, and the asymmetry is
 * deliberate.**
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
 * **`params` is read by three entries, and only through the write schema.** The five Stage C
 * entries declare no fields, so there is no parameter for them to read — a dataset's row cap
 * comes from `MAX_DATASET_ROWS`, not from a request. The two `sustainability.*` entries
 * (`E4.2`, ADR 0072 decision 2) take `{ pointKey, aggregate }` and, since `E4.3` (ADR 0073
 * decision 2), an optional `balanceRole` that narrows the carrying set — `by_location` also
 * takes an optional `groupDepth` since `F2.10` (ADR 0098 Amendment 1, C); `water.balance` (`E4.3`,
 * ADR 0073 decision 3) takes `{ period }`. The stored row is re-parsed
 * through `METRIC_CATALOG_PARAMS_WRITE` before a resolver sees it, and a row that fails to
 * parse is SKIPPED with one warning naming the field path (§4.3) — never thrown, because one
 * bad binding must not take the whole dashboard's values down. A filter is always a field on
 * the entry's write schema (and the containment test still passing), never a query-string
 * parameter.
 *
 * **One resolve per distinct `(catalogKey, canonical params, scope key)`, not per key.** Two
 * tiles binding `sustainability.total` with different `pointKey`s are two different numbers; two
 * tiles binding `alarms.active.count` on one tab are still one query, because their params are
 * both `{}`. Since `F3.73` (plan D3) the scope is PER WIDGET: a widget on a tab that binds an
 * asset group resolves over that group, every other widget over the dashboard's scope — so the
 * same key on two group tabs is two resolves (`planResolves`), and each distinct scope is
 * resolved to asset ids once (`resolveAssetScope`, `dashboard-scope-assets.ts`).
 */
@Injectable()
export class MetricCatalogService {
  private readonly logger = new Logger(MetricCatalogService.name);

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
      await this.accessControl.readableLocationIds(jwt),
    );
  }

  /**
   * Resolves every catalog binding on one dashboard.
   *
   * `readableAssetIds` is the caller's own scope — `null` means "every asset in the
   * organization", matching `AccessControlService.readableAssetIds`' own convention.
   * `readableLocationIds` (`F2.10`) is the same caller's location list under the same
   * convention. Required, not defaulted: a permissive default at this seam would be invisible
   * to the compiler and read every ancestor as readable.
   */
  async resolveForDashboard(
    organizationId: string,
    dashboardId: string,
    readableAssetIds: readonly string[] | null,
    readableLocationIds: readonly string[] | null,
  ): Promise<DashboardCatalogValuesResponse> {
    // Never `?? null`: an `undefined` that slipped past the compiler must fail closed (an empty
    // set), not read as "every location".
    const readableLocations: ReadonlySet<string> | null =
      readableLocationIds === null ? null : new Set(readableLocationIds);
    return withTenant(this.tenantDb, organizationId, async (tx) => {
      const [dashboard] = await tx
        .select()
        .from(dashboards)
        .where(eq(dashboards.id, dashboardId))
        .limit(1);
      if (!dashboard) {
        return { values: [], resolvedAt: new Date().toISOString() };
      }
      // Owner rulings P1 and P4: the cap on a grouped `by_location` row is the dashboard's own
      // node. A group-scoped dashboard's node is its GROUP's location — read here, never taken
      // from the request, with the organization predicate explicit (`resolveAssetScope`'s
      // reason). `dashboards_scope_check` allows one scope column; an asset-scoped dashboard
      // stays uncapped.
      const capLocationId =
        dashboard.locationId ??
        (dashboard.assetGroupId === null
          ? null
          : ((
              await tx
                .select({ locationId: assetGroups.locationId })
                .from(assetGroups)
                .where(
                  and(eq(assetGroups.id, dashboard.assetGroupId), eq(assetGroups.organizationId, organizationId)),
                )
                .limit(1)
            )[0]?.locationId ?? null));

      // `F3.73` — each widget's tab, and the group that tab binds (NULL for the Overview and
      // for a legacy widget with no tab). The join carries its own organization predicate,
      // EXPLICIT rather than delegated to RLS, for the reason `resolveAssetScope`'s location
      // arm states: the predicate is what makes the read correct on any pool (`bms_fleet`
      // holds BYPASSRLS). A tab stamped with another organization therefore reads as "no
      // group", and its widget falls back to the dashboard's scope — never wider.
      const widgetRows = await tx
        .select({ id: dashboardWidgets.id, tabGroupId: dashboardTabs.assetGroupId })
        .from(dashboardWidgets)
        .leftJoin(
          dashboardTabs,
          and(
            eq(dashboardTabs.id, dashboardWidgets.tabId),
            eq(dashboardTabs.dashboardId, dashboardWidgets.dashboardId),
            eq(dashboardTabs.organizationId, organizationId),
          ),
        )
        .where(eq(dashboardWidgets.dashboardId, dashboardId));
      const sources = await resolveWidgetSources(
        tx,
        organizationId,
        widgetRows.map((widget) => widget.id),
      );
      if (sources.length === 0) {
        return { values: [], resolvedAt: new Date().toISOString() };
      }

      // A group tab's widget resolves over the GROUP: `locationId` null, or the location arm
      // fires first and the group is ignored (`DashboardAssetScope`'s docblock).
      const tabGroupOf = new Map(widgetRows.map((widget) => [widget.id, widget.tabGroupId]));
      const scopeOfWidget = (widgetId: string): DashboardAssetScope => {
        const tabGroupId = tabGroupOf.get(widgetId) ?? null;
        return tabGroupId === null
          ? dashboard
          : { assetId: null, locationId: null, assetGroupId: tabGroupId };
      };

      const plan = planResolves(sources, scopeOfWidget, (source, key, paths) => {
        // A stored row the write schema no longer accepts (a hand-edited row, or a schema
        // tightened after the write). Skipped, not thrown: the other bindings still resolve.
        // ONE string: `this.logger` is Nest's `Logger` routed through nestjs-pino, where a
        // trailing string argument is read as the CONTEXT and an object becomes fields with
        // no message. Field paths only, never the params values (§4.3 / §9.6).
        this.logger.warn(
          "catalog binding params failed the entry's write schema; binding skipped: " +
            `dashboard ${dashboardId}, source ${source.id}, key ${key}, paths ${paths}`,
        );
      });

      // One scope resolution per distinct scope key, however many resolves share it.
      const scopeByKey = new Map<string, readonly string[]>();
      const byKey = new Map<string, MetricCatalogValueDto>();
      for (const [resolveKey, planned] of plan.resolves) {
        const resolver = RESOLVERS[planned.key];
        if (resolver === undefined) continue;
        let scope = scopeByKey.get(planned.scopeKey);
        if (scope === undefined) {
          scope = await resolveAssetScope(tx, organizationId, planned.scope, readableAssetIds, {
            subtree: planned.subtree,
          });
          scopeByKey.set(planned.scopeKey, scope);
        }
        byKey.set(
          resolveKey,
          await resolver(
            tx,
            organizationId,
            scope,
            {
              health: this.health,
              readableLocationIds: readableLocations,
              // Owner rulings P1 and P4: the cap is the DASHBOARD's node, not the resolve's
              // scope — a group tab's widget resolves with `locationId` null yet sits on this
              // dashboard. `capLocationId`'s own comment says how it is read.
              scopeLocationId: capLocationId,
            },
            planned.params,
          ),
        );
      }
      const resolveKeyOf = plan.resolveKeyOf;

      return {
        values: sources.flatMap((source) => {
          const resolveKey = resolveKeyOf.get(source.id);
          const resolved = resolveKey === undefined ? undefined : byKey.get(resolveKey);
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
}

/**
 * An empty scope is a real state — a caller scoped to an asset group holding no assets — and
 * every entry below routes it to a zero answer before building SQL (`assets.health.score`
 * through `AssetHealthService.summary`'s own guard; `sustainability.total` since the `E4.2`
 * PR 1 sweep — it read the point's unit and the organization's currency first, and
 * `metric-catalog.service.spec.ts` now drives each sustainability entry with a transaction
 * that refuses every statement).
 *
 * **This comment used to claim `inArray(x, [])` emits `in ()`, a Postgres syntax error. That is
 * false at the pinned version** (security review), and it was copied here from
 * `AssetHealthService.summary`, which carried the same wrong reason. Drizzle 0.38.4 returns
 * ``sql`false` `` for an empty array. So these guards save a round trip and return the right
 * SHAPE — a zero count, an empty dataset — rather than preventing a crash. Keep them; do not
 * keep the reason.
 */
/** One stored binding, as `resolveWidgetSources` returns it — the fields `planResolves` reads. */
type PlannableSource = {
  readonly id: string;
  readonly widgetId: string;
  readonly catalogKey: string;
  readonly params: unknown;
};

/** One distinct resolve: an entry, its parsed params, and the scope it runs over. */
export type PlannedResolve = {
  readonly key: MetricCatalogKey;
  readonly params: unknown;
  readonly scope: DashboardAssetScope;
  readonly scopeKey: string;
  /** `F2.10` — a location scope resolves over the node's subtree (`SUBTREE_SCOPED_KEYS`). */
  readonly subtree: boolean;
};

/**
 * `F2.10` / ADR 0098 decision 7, B1 — the entries whose location scope is the node's SUBTREE.
 * Every other entry (the alarm and work-order reads, `assets.*`, `water.balance`) stays per
 * node: a campus dashboard's alarm list is the campus's own, not its sites'.
 */
const SUBTREE_SCOPED_KEYS: ReadonlySet<MetricCatalogKey> = new Set<MetricCatalogKey>([
  "sustainability.total",
  "sustainability.by_location",
]);

/**
 * Groups a dashboard's bindings into DISTINCT resolves, keyed `(catalogKey, canonical params,
 * scope key)` — pure, so the dedupe is claimed without a database
 * (`metric-catalog.service.spec.ts`).
 *
 * `E4.2`: two tiles binding `sustainability.total` with different point keys are two resolves,
 * and two tiles binding `alarms.active.count` are one because their params are both `{}`.
 * `F3.73` (plan D3): the key gains the widget's scope, because the same key on two tabs bound
 * to two groups is two different numbers — without it the second tile shows the first tab's
 * count, and nothing throws.
 *
 * A binding whose params fail the entry's write schema is reported through `onInvalid` (field
 * paths only) and left out; a key with no write schema is left out silently, as before.
 */
export function planResolves(
  sources: readonly PlannableSource[],
  scopeOfWidget: (widgetId: string) => DashboardAssetScope,
  onInvalid: (source: PlannableSource, key: MetricCatalogKey, paths: string) => void,
): {
  readonly resolveKeyOf: ReadonlyMap<string, string>;
  readonly resolves: ReadonlyMap<string, PlannedResolve>;
} {
  const resolveKeyOf = new Map<string, string>();
  const resolves = new Map<string, PlannedResolve>();
  for (const source of sources) {
    const key = source.catalogKey as MetricCatalogKey;
    const schema = METRIC_CATALOG_PARAMS_WRITE[key];
    if (schema === undefined) continue;
    const parsed = schema.safeParse(source.params);
    if (!parsed.success) {
      onInvalid(source, key, parsed.error.issues.map((issue) => issue.path.join(".")).join(","));
      continue;
    }
    const scope = scopeOfWidget(source.widgetId);
    const subtree = SUBTREE_SCOPED_KEYS.has(key);
    const scopeKey = scopeKeyFor(scope, { subtree });
    const resolveKey = `${key}\u0000${canonicalJson(parsed.data)}\u0000${scopeKey}`;
    resolveKeyOf.set(source.id, resolveKey);
    if (!resolves.has(resolveKey)) {
      resolves.set(resolveKey, { key, params: parsed.data, scope, scopeKey, subtree });
    }
  }
  return { resolveKeyOf, resolves };
}

/**
 * A key-sorted JSON encoding, so `{ pointKey, aggregate }` and `{ aggregate, pointKey }` are
 * one resolve. The write schemas are flat objects of scalars, so one level of sorting is the
 * whole canonical form.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return JSON.stringify(
    Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])),
  );
}

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
 * An active alarm is one that has not been cleared.
 *
 * ADR 0057 decision 1: active = `cleared_at IS NULL`, since migration `0066`. An acknowledged
 * alarm is still active — acknowledgement only annotates who is handling it, and clearing is
 * the sole predicate this file counts against.
 */
const activeAlarmWhere = (organizationId: string, scope: readonly string[]) =>
  and(
    eq(alarms.organizationId, organizationId),
    isNull(alarms.clearedAt),
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

/**
 * `F3.73` (ruling Q6a/Q6b) — the active assets in `scope`, LEFT JOINed to the shared `live` CTE:
 * an asset with no row in `live` has no sample of any point inside the live window, and is
 * offline. The one place this file names the CTE, so the two entries that read it cannot
 * drift apart and `tests/f3.28-offline-bound-single-source.test.ts` counts one site here.
 *
 * `a.active` is required: a retired asset is neither live nor offline — it is absent, as it is
 * from the role summary's `offlineCount` (`asset-role-summary.service.ts`). The scope's
 * location and group arms do not filter on it, so this does. The organization predicate is
 * explicit for the reason the file docblock states.
 */
const inScopeAssetsWithLiveness = (
  organizationId: string,
  scope: readonly string[],
  select: SQL,
  tail: SQL,
): SQL => sql`
  WITH ${sql.raw(LIVE_ASSETS_CTE_SQL)}
  SELECT ${select}
    FROM bms.assets a
    LEFT JOIN live ON live.asset_id = a.id
   WHERE a.id = ANY(${sql.param([...scope])}::uuid[])
     AND a.organization_id = ${organizationId}
     AND a.active
   ${tail}
`;

/** Exported for `metric-catalog.service.spec.ts`'s no-database claims only; the service is the API. */
export const RESOLVERS: Record<MetricCatalogKey, Resolver> = {
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

  /**
   * `E4.2` / ADR 0072 decision 2 — `pointKey` rolled up across the carrying assets in scope.
   * `coverage` and `currency` are the metric arm's two optional fields and this is the one
   * entry that emits them; `currency` is the organization's only for a LISTED money code
   * (`MONEY_POINT_KEY_CODES`, sweep ruling 2026-09-22 — the unit `""` is the no-unit
   * spelling of 247 codes and decides nothing), else `null`. An empty scope is `0/0`,
   * `null`, no unit and no currency before any SQL (sweep — PR 1 read the unit and the
   * currency first), like the other entries' "no source".
   */
  "sustainability.total": async (tx, organizationId, scope, _deps, params) => {
    if (scopeIsEmpty(scope)) {
      return {
        shape: "metric",
        key: "sustainability.total",
        value: null,
        unit: null,
        coverage: { fresh: 0, carrying: 0 },
        currency: null,
      };
    }
    const { pointKey, aggregate, balanceRole } = params as SustainabilityParams;
    const rows = await readRollupRows(tx, organizationId, scope, pointKey, balanceRole);
    const { value, coverage } = rollup(rows, aggregate);
    const unit = await readPointKeyUnit(tx, pointKey);
    const currency = isMoneyPointKey(pointKey)
      ? rollupCurrency(new Set([await readOrganizationCurrency(tx, organizationId)]))
      : null;
    return {
      shape: "metric",
      key: "sustainability.total",
      value,
      unit: unit || null,
      coverage,
      currency,
    };
  },

  /**
   * The same roll-up grouped by location, one row per location that owns at least one asset
   * in the resolved scope (plan OQ7), in `code` order. A location whose assets carry the point
   * on no template is present as `null` / `"0/0"` — a site with no meters is visible as such
   * (ADR 0072 ruling 3). `coverage` is the string `"fresh/carrying"` because a dataset cell is
   * a scalar (plan OQ4). Capped like its dataset siblings: the location query reads
   * `MAX_DATASET_ROWS + 1` and `capRows` decides `truncated` from what came back.
   *
   * `F2.10` (ADR 0098 decision 7, A6, B2, C; amends ADR 0072 decision 2): with `groupDepth`
   * set, each location folds into its group node (`groupLocationsAtDepth`) and the rows are the
   * distinct group nodes in `code` order, labelled with the GROUP's code and name — never a node
   * above the dashboard's own (`scopeLocationId`, owner rulings P1 and P4). The location
   * read is then UNCAPPED — a cap on the fold's input would truncate it silently — and
   * `capRows` applies to the grouped rows.
   */
  "sustainability.by_location": async (tx, organizationId, scope, deps, params) => {
    if (scopeIsEmpty(scope)) return datasetValue("sustainability.by_location", [], false);
    const { pointKey, aggregate, balanceRole, groupDepth } = params as SustainabilityParams;
    // The ROW set is not narrowed by `balanceRole` (E4.2 OQ7 stands): a location owning an
    // asset in scope is a row even when none of its assets has the role — it reads `0/0`.
    const locationRead = tx
      .select({ id: locations.id, code: locations.code, name: locations.name })
      .from(assets)
      .innerJoin(locations, eq(locations.id, assets.locationId))
      .where(and(eq(assets.organizationId, organizationId), scopedTo(assets.id, scope)))
      .groupBy(locations.id, locations.code, locations.name)
      .orderBy(asc(locations.code));
    const carrying = await readRollupRows(tx, organizationId, scope, pointKey, balanceRole);
    if (groupDepth !== undefined) {
      const inScope = await locationRead;
      const groups = await groupLocationsAtDepth(
        tx,
        { organizationIds: [organizationId], ids: inScope.map((location) => location.id) },
        groupDepth,
        deps.readableLocationIds,
        deps.scopeLocationId,
      );
      const groupNodes = [...new Map([...groups.values()].map((group) => [group.id, group])).values()].sort(
        (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
      );
      const capped = capRows(groupNodes);
      const rows = capped.rows.map((group) => {
        const { value, coverage } = rollup(
          carrying.filter((row) => groups.get(row.locationId)?.id === group.id),
          aggregate,
        );
        return {
          locationCode: group.code,
          locationName: group.name,
          value,
          coverage: `${coverage.fresh}/${coverage.carrying}`,
        };
      });
      return datasetValue("sustainability.by_location", rows, capped.truncated);
    }
    const inScope = await locationRead.limit(MAX_DATASET_ROWS + 1);
    const capped = capRows(inScope);
    const rows = capped.rows.map((location) => {
      const { value, coverage } = rollup(
        carrying.filter((row) => row.locationId === location.id),
        aggregate,
      );
      return {
        locationCode: location.code,
        locationName: location.name,
        value,
        coverage: `${coverage.fresh}/${coverage.carrying}`,
      };
    });
    return datasetValue("sustainability.by_location", rows, capped.truncated);
  },

  /**
   * `E4.3` / ADR 0073 decision 3 — one row per site: intake, reuse, discharge, consumed-or-lost
   * and coverage for one `period`. The rules of the row live in `water-balance.ts`
   * (`waterBalanceRow`); this reads what it folds.
   *
   * **The point keys are derived from `period` here and nowhere else**: intake is
   * `kl_<period>` over the `intake` assets, reuse and discharge are `outlet_kl_<period>` over
   * the `reuse` and `discharge` assets. `internal` assets are read by no column. A tenant whose
   * water templates predate v5 carries no `outlet_kl_*` row, so reuse and discharge read `null`
   * and add nothing to the coverage (not `"0/0"`: intake still counts) until the templates are
   * re-imported (ADR 0073 decision 2's re-import rule) — and a site with such a discharge
   * asset reads `consumed` as `null`, never `intake − 0`, because
   * `readBalanceLocations` counts the discharge assets that cannot report (PR 2 review). It
   * counts the intake assets the same way, so an intake meter without the period's `kl_*`
   * point makes `consumed` `null` too (the PR 2 post-merge sweep ruling).
   *
   * Four to seven statements per resolve: the location read, then three `readRollupRows`
   * calls of one statement each, or two when anything carries. An empty scope returns the empty
   * dataset before any SQL.
   */
  "water.balance": async (tx, organizationId, scope, _deps, params) => {
    if (scopeIsEmpty(scope)) return datasetValue("water.balance", [], false);
    const { period } = params as WaterBalanceParams;
    const locationsInScope = await readBalanceLocations(tx, organizationId, scope);
    const intake = await readRollupRows(tx, organizationId, scope, `kl_${period}`, "intake");
    const reuse = await readRollupRows(tx, organizationId, scope, `outlet_kl_${period}`, "reuse");
    const discharge = await readRollupRows(
      tx,
      organizationId,
      scope,
      `outlet_kl_${period}`,
      "discharge",
    );
    const capped = capRows(locationsInScope);
    const at = (rows: readonly RollupRow[], locationId: string) =>
      rows.filter((row) => row.locationId === locationId);
    const rows = capped.rows.map((location) => ({
      locationCode: location.code,
      locationName: location.name,
      ...waterBalanceRow({
        intake: at(intake, location.id),
        reuse: at(reuse, location.id),
        discharge: at(discharge, location.id),
        dischargeAssets: location.dischargeAssets,
        intakeAssets: location.intakeAssets,
      }),
    }));
    return datasetValue("water.balance", rows, capped.truncated);
  },

  /**
   * `F3.73` (ruling Q6b correction) — the active assets in scope with no sample inside the live
   * window. The same site or group scope as `alarms.active.count`, and the same offline test as
   * the role summary (ruling Q6a): `live.asset_id IS NULL`. Uncapped — it is a count.
   */
  "assets.offline.count": async (tx, organizationId, scope) => {
    if (scopeIsEmpty(scope)) return metricValue("assets.offline.count", 0, null);
    const result = await tx.execute<{ n: number }>(
      inScopeAssetsWithLiveness(
        organizationId,
        scope,
        sql`count(*)::int AS n`,
        sql`AND live.asset_id IS NULL`,
      ),
    );
    return metricValue("assets.offline.count", result.rows[0]?.n ?? 0, null);
  },

  /**
   * `F3.73` — one row per active asset in scope, in `code` order: `status` is `live` or
   * `offline` by the same test as `assets.offline.count`, and `activeAlarms` counts the asset's
   * uncleared alarms (ADR 0057 decision 1). No `role` column: the `Resolver` signature carries
   * asset ids only, and a role is a group membership (plan D3). Capped like its siblings.
   */
  "assets.list": async (tx, organizationId, scope) => {
    if (scopeIsEmpty(scope)) return datasetValue("assets.list", [], false);
    // The alarm subquery carries its own organization predicate, for the reason `alarms.active`
    // states: `bms.alarms`' policy has no parent-asset leg.
    const result = await tx.execute<{
      code: string;
      name: string;
      offline: boolean;
      active_alarms: number;
    }>(
      inScopeAssetsWithLiveness(
        organizationId,
        scope,
        sql`a.code,
            a.name,
            (live.asset_id IS NULL) AS offline,
            (SELECT count(*)::int
               FROM bms.alarms al
              WHERE al.asset_id = a.id
                AND al.organization_id = ${organizationId}
                AND al.cleared_at IS NULL) AS active_alarms`,
        sql`ORDER BY a.code LIMIT ${MAX_DATASET_ROWS + 1}`,
      ),
    );
    const capped = capRows(result.rows);
    return datasetValue(
      "assets.list",
      capped.rows.map((row) => ({
        code: row.code,
        name: row.name,
        status: row.offline ? "offline" : "live",
        activeAlarms: row.active_alarms,
      })),
      capped.truncated,
    );
  },
};
