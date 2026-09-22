import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import {
  alarms,
  assetGroupMembers,
  assets,
  dashboards,
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
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { resolveWidgetSources } from "./dashboard-source-scope";
import { METRIC_CATALOG_PARAMS_WRITE } from "./dashboards.schema";
import {
  readOrganizationCurrency,
  readPointKeyUnit,
  readRollupRows,
  rollup,
  rollupCurrency,
} from "./sustainability-rollup";

/**
 * What a resolver may reach for beyond the transaction.
 *
 * Passed explicitly rather than bound as `this`. Six of the seven entries need nothing here, and
 * a `this`-bound map would have to be cast to reach the service's injected dependency — a cast
 * on the one path that calls another module's service.
 */
type ResolverDeps = { readonly health: AssetHealthService };

/**
 * How the catalog's entries resolve: four are SQL here, one delegates, two roll up a point key.
 *
 * `params` is the binding's stored `params` AFTER `METRIC_CATALOG_PARAMS_WRITE[key]` has
 * parsed it (`E4.2`): `{}` for the five Stage C entries, `{ pointKey, aggregate }` for the
 * two sustainability entries. Positional and required rather than optional, so a resolver
 * that reads a field cannot compile against a call that never passes one.
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
};

/**
 * `F3.35` Stage C — resolving a dashboard's named catalog bindings (ADR 0048 decisions 1 and 2).
 *
 * **Six entries are SQL written here (four Stage C reads and the two `E4.2` roll-ups, whose
 * statements live in `sustainability-rollup.ts`); one is a service call, and the asymmetry is
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
 * **`params` is read by two entries, and only through the write schema.** The five Stage C
 * entries declare no fields, so there is no parameter for them to read — a dataset's row cap
 * comes from `MAX_DATASET_ROWS`, not from a request. The two `sustainability.*` entries
 * (`E4.2`, ADR 0072 decision 2) take `{ pointKey, aggregate }`: the stored row is re-parsed
 * through `METRIC_CATALOG_PARAMS_WRITE` before a resolver sees it, and a row that fails to
 * parse is SKIPPED with one warning naming the field path (§4.3) — never thrown, because one
 * bad binding must not take the whole dashboard's values down. A filter is always a field on
 * the entry's write schema (and the containment test still passing), never a query-string
 * parameter.
 *
 * **One resolve per distinct `(catalogKey, canonical params)`, not per key.** Two tiles
 * binding `sustainability.total` with different `pointKey`s are two different numbers; two
 * tiles binding `alarms.active.count` are still one query, because their params are both `{}`.
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

      // One resolve per DISTINCT (catalogKey, canonical params), not per binding (`E4.2`).
      // Two tiles binding `alarms.active.count` on one dashboard are one query; two tiles
      // binding `sustainability.total` with different point keys are two.
      const resolveKeyOf = new Map<string, string>();
      const paramsByResolveKey = new Map<string, unknown>();
      for (const source of sources) {
        const key = source.catalogKey as MetricCatalogKey;
        const schema = METRIC_CATALOG_PARAMS_WRITE[key];
        if (schema === undefined) continue;
        const parsed = schema.safeParse(source.params);
        if (!parsed.success) {
          // A stored row the write schema no longer accepts (a hand-edited row, or a schema
          // tightened after the write). Skipped, not thrown: the other bindings still resolve.
          this.logger.warn(
            {
              dashboardId,
              sourceId: source.id,
              catalogKey: key,
              paths: parsed.error.issues.map((issue) => issue.path.join(".")),
            },
            "catalog binding params failed the entry's write schema; binding skipped",
          );
          continue;
        }
        const resolveKey = `${key}\u0000${canonicalJson(parsed.data)}`;
        resolveKeyOf.set(source.id, resolveKey);
        paramsByResolveKey.set(resolveKey, parsed.data);
      }
      const byKey = new Map<string, MetricCatalogValueDto>();
      for (const [resolveKey, params] of paramsByResolveKey) {
        const key = resolveKey.slice(0, resolveKey.indexOf("\u0000")) as MetricCatalogKey;
        const resolver = RESOLVERS[key];
        if (resolver === undefined) continue;
        byKey.set(
          resolveKey,
          await resolver(tx, organizationId, scope, { health: this.health }, params),
        );
      }

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

  /**
   * The dashboard's scope and the caller's, intersected into one asset-id list.
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

  /**
   * `E4.2` / ADR 0072 decision 2 — `pointKey` rolled up across the carrying assets in scope.
   * `coverage` and `currency` are the metric arm's two optional fields and this is the one
   * entry that emits them; `currency` is the organization's only for a money point (unit
   * `""`, the E4.1c spelling), else `null`. An empty scope is `0/0` and `null`, like the
   * other entries' "no source".
   */
  "sustainability.total": async (tx, organizationId, scope, _deps, params) => {
    const { pointKey, aggregate } = params as SustainabilityParams;
    const rows = await readRollupRows(tx, organizationId, scope, pointKey);
    const { value, coverage } = rollup(rows, aggregate);
    const unit = await readPointKeyUnit(tx, pointKey);
    const currency =
      unit === ""
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
   * a scalar (plan OQ4). Never truncated: the row count is the location count, which
   * `MAX_DATASET_ROWS` bounds comfortably.
   */
  "sustainability.by_location": async (tx, organizationId, scope, _deps, params) => {
    if (scopeIsEmpty(scope)) return datasetValue("sustainability.by_location", [], false);
    const { pointKey, aggregate } = params as SustainabilityParams;
    const inScope = await tx
      .select({ id: locations.id, code: locations.code, name: locations.name })
      .from(assets)
      .innerJoin(locations, eq(locations.id, assets.locationId))
      .where(and(eq(assets.organizationId, organizationId), scopedTo(assets.id, scope)))
      .groupBy(locations.id, locations.code, locations.name)
      .orderBy(asc(locations.code));
    const carrying = await readRollupRows(tx, organizationId, scope, pointKey);
    const rows = inScope.map((location) => {
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
    return datasetValue("sustainability.by_location", rows, false);
  },
};
