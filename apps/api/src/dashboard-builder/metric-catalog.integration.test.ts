import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { METRIC_CATALOG } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertCallerScopeIntersects,
  assertDatasetShapeAndClamp,
  assertDeletedWidgetDropsItsBinding,
  assertHealthScoreDelegates,
  assertUnnarrowedScopeStaysInsideTheOrganization,
  assertLocationScopeNarrowsTheCount,
  assertNoBindingsResolvesEmpty,
} from "./metric-catalog.integration.spec";
import { MetricCatalogService } from "./metric-catalog.service";

/**
 * `F3.35` Stage C — Vitest entry point for the catalog resolve. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle and the fixture.
 *
 * **The fixture builds its own locations, assets and alarms, and never reads the seed's.**
 * `F4.66` bans an assertion on a count over a whole table, and `F4.67`/`F4.68` ban a positional
 * read of `bms.assets` — both for the same reason, which bites hard here: this suite asserts
 * exact numbers, and any parallel suite holding an alarm open would move them. Every row below
 * carries a per-run suffix (`F4.65`) and the whole fixture is deleted in `afterAll`.
 *
 * **No new organization.** Creating one would have made the organization-wide numbers trivially
 * deterministic, and it would also have inserted a row into `bms.organizations` — which
 * `f3.1a-dashboard-schema.integration.test.ts`, `f3.35-metric-catalog-schema.integration.test.ts`
 * and this feature's own source-scope suite all read `ORDER BY code` and index positionally. A
 * new row is a suite-ordering hazard for a benefit the caller-scope parameter already provides:
 * passing the fixture's own asset ids as the caller's readable set makes every number this
 * suite asserts its own, and exercises the dashboard-scope ∩ caller-scope intersection while
 * doing it.
 *
 * The pools are `max: 1` for the reason `dashboard-source-scope.integration.test.ts` records:
 * `max_connections` is 100, the repo opens ~119 integration pools at a default of 4, and the
 * suite sheds whichever file loses the race. Nothing here provokes a deliberate query error, so
 * one connection is safe.
 */
const connectionString = requireIntegrationDb({
  item: "F3.35",
  label: "the metric catalog resolve (Stage C, Unit 4)",
  because:
    "whether a location-scoped dashboard narrows its alarm count is a fact about real rows and " +
    "a real join — and it is the failure mode this unit exists to prevent, because an " +
    "organization-wide number on a site dashboard throws nothing and renders fine.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.35 Stage C — the metric catalog resolve", () => {
  let superuserPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetDb: BmsDb;
  let service: MetricCatalogService;
  // A second service whose `AssetHealthService` is a capturing stub. It exists to observe the
  // SCOPE the health resolver is handed, which is the only organization bound that entry has —
  // see `assertUnnarrowedScopeStaysInsideTheOrganization`.
  let capturingService: MetricCatalogService;
  let capturedHealthScope: readonly string[] | null | undefined;

  let orgId = "";
  let assetA = "";
  let assetB = "";
  const dashboardIds: string[] = [];
  const locationIds: string[] = [];
  let scopedDashboardId = "";
  let wideDashboardId = "";
  let datasetDashboardId = "";
  let healthDashboardId = "";
  let emptyDashboardId = "";
  let deletableDashboardId = "";
  let deletableWidgetId = "";

  const ALARMS_AT_A = 2;
  const ALARMS_AT_B = 3;

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 1 } as const;
    superuserPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "F3.35 Unit 4",
      POOL,
    );
    fleetPool = await openIntegrationPool(url, "F3.35 Unit 4", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.35 Unit 4",
      POOL,
    );
    fleetDb = createDb(fleetPool);

    // `accessControl` is never reached: this suite drives `resolveForDashboard`, the
    // unauthorized core, and `catalogValues`'s two guards are the controller spec's subject.
    service = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
    );

    // The capturing twin. `summary` records the ids it was given and answers the null score
    // `E1.3` genuinely returns against seeded data, so nothing downstream changes shape.
    capturingService = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      {
        summary: async (assetIds: readonly string[] | null) => {
          capturedHealthScope = assetIds;
          return { score: null, bands: [], assetCount: 0, scoredCount: 0 };
        },
      } as unknown as AssetHealthService,
    );

    const org = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    );
    orgId = org.rows[0]?.id ?? "";
    if (!orgId) throw new Error("F3.35 Unit 4: ESKOM organization not found — run pnpm db:seed");

    const domain = await fleetPool.query<{ code: string }>(
      `SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`,
    );
    const domainCode = domain.rows[0]?.code;

    const locA = await superuserPool.query<{ id: string }>(
      // `type`, `latitude` and `longitude` are all NOT NULL with no default. `type` reuses an
      // existing value rather than inventing one — `bms.locations.type` is the SMOC-era site
      // vocabulary, and a new value here would be a vocabulary change smuggled in by a fixture.
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
      [orgId, `F335A-${RUN}`, `f335a-${RUN}`, `F3.35 site A ${RUN}`],
    );
    const locB = await superuserPool.query<{ id: string }>(
      // `type`, `latitude` and `longitude` are all NOT NULL with no default. `type` reuses an
      // existing value rather than inventing one — `bms.locations.type` is the SMOC-era site
      // vocabulary, and a new value here would be a vocabulary change smuggled in by a fixture.
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
      [orgId, `F335B-${RUN}`, `f335b-${RUN}`, `F3.35 site B ${RUN}`],
    );
    const locationA = locA.rows[0]?.id as string;
    const locationB = locB.rows[0]?.id as string;
    locationIds.push(locationA, locationB);

    const mkAsset = async (locationId: string, tag: string): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, locationId, `F335-${tag}-${RUN}`, `F3.35 ${tag} ${RUN}`, "F3.35", domainCode],
      );
      return row.rows[0]?.id as string;
    };
    assetA = await mkAsset(locationA, "A");
    assetB = await mkAsset(locationB, "B");


    const severity = await fleetPool.query<{ code: string }>(
      `SELECT code FROM bms.alarm_severities ORDER BY rank LIMIT 1`,
    );
    const severityCode = severity.rows[0]?.code ?? "critical";

    // Unacknowledged: `acknowledged_at IS NULL` is the whole definition of active.
    for (let i = 0; i < ALARMS_AT_A; i += 1) {
      await superuserPool.query(
        `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at)
         VALUES ($1, $2, $3, $4, now())`,
        [orgId, assetA, severityCode, `F3.35 A${i} ${RUN}`],
      );
    }
    for (let i = 0; i < ALARMS_AT_B; i += 1) {
      await superuserPool.query(
        `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at)
         VALUES ($1, $2, $3, $4, now())`,
        [orgId, assetB, severityCode, `F3.35 B${i} ${RUN}`],
      );
    }
    // One ACKNOWLEDGED alarm on A, so "active" is doing work rather than meaning "all".
    await superuserPool.query(
      `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, acknowledged_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [orgId, assetA, severityCode, `F3.35 acked ${RUN}`],
    );

    /** A dashboard with one `value_tile` bound to one catalog entry. */
    const mkDashboard = async (
      tag: string,
      catalogKey: string | null,
      locationId: string | null,
    ): Promise<{ dashboardId: string; widgetId: string }> => {
      const dash = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, `f335u4-${tag}-${RUN}`, `F3.35 U4 ${tag}`, locationId],
      );
      const dashboardId = dash.rows[0]?.id as string;
      dashboardIds.push(dashboardId);
      if (catalogKey === null) return { dashboardId, widgetId: "" };

      const widget = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'value_tile', 0, 0, 3, 2) RETURNING id`,
        [orgId, dashboardId],
      );
      const widgetId = widget.rows[0]?.id as string;
      await superuserPool.query(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
         VALUES ($1, $2, $3)`,
        [orgId, widgetId, catalogKey],
      );
      return { dashboardId, widgetId };
    };

    scopedDashboardId = (await mkDashboard("scoped", "alarms.active.count", locationA)).dashboardId;
    wideDashboardId = (await mkDashboard("wide", "alarms.active.count", null)).dashboardId;
    datasetDashboardId = (await mkDashboard("dataset", "alarms.active", null)).dashboardId;
    healthDashboardId = (await mkDashboard("health", "assets.health.score", null)).dashboardId;
    emptyDashboardId = (await mkDashboard("empty", null, null)).dashboardId;
    const deletable = await mkDashboard("deletable", "alarms.active.count", null);
    deletableDashboardId = deletable.dashboardId;
    deletableWidgetId = deletable.widgetId;
  }, 60_000);

  afterAll(async () => {
    // Dashboards cascade to widgets and bindings; assets cascade to alarms; locations last.
    // Guarded on truthiness throughout: `beforeAll` can fail partway, and an `afterAll` that
    // then throws `invalid input syntax for type uuid: ""` reports the CLEANUP as the failure
    // and buries the real one. Measured — that is exactly what the first run of this file did.
    for (const id of dashboardIds.filter(Boolean)) {
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [id]);
    }
    const fixtureAssets = [assetA, assetB].filter(Boolean);
    if (fixtureAssets.length > 0) {
      await superuserPool.query(`DELETE FROM bms.alarms WHERE asset_id = ANY($1::uuid[])`, [
        fixtureAssets,
      ]);
      await superuserPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [
        fixtureAssets,
      ]);
    }
    // BY ID, never `code LIKE 'F335%-…'`. `tests/integration-fixture-isolation.test.ts` refuses
    // a prefix sweep even one carrying a per-run suffix, and it is right to: the `%` makes the
    // statement a family-wide pattern, and the guard cannot tell a safe one from a careless one
    // by reading it. Ids are exact and need no such judgement.
    const fixtureLocations = locationIds.filter(Boolean);
    if (fixtureLocations.length > 0) {
      await superuserPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [
        fixtureLocations,
      ]);
    }
    await Promise.all([superuserPool, fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("narrows a location-scoped dashboard's count to its own location", async () => {
    await assertLocationScopeNarrowsTheCount(
      service,
      orgId,
      scopedDashboardId,
      wideDashboardId,
      [assetA, assetB],
      ALARMS_AT_A,
      ALARMS_AT_A + ALARMS_AT_B,
    );
  });

  it("intersects the caller's readable assets with the dashboard's scope", async () => {
    await assertCallerScopeIntersects(service, orgId, wideDashboardId, [assetA], ALARMS_AT_A);
  });

  it("resolves a dataset to its declared columns, clamped and flagged", async () => {
    const meta = METRIC_CATALOG["alarms.active"];
    await assertDatasetShapeAndClamp(
      service,
      orgId,
      datasetDashboardId,
      [assetA, assetB],
      meta.shape === "dataset" ? meta.columns : [],
    );
  });

  it("delegates the health score to E1.3 rather than recomputing it", async () => {
    await assertHealthScoreDelegates(service, orgId, healthDashboardId);
  });

  it("keeps an un-narrowed dashboard's scope inside the organization for an unrestricted admin", async () => {
    capturedHealthScope = undefined;
    await assertUnnarrowedScopeStaysInsideTheOrganization(
      capturingService,
      () => capturedHealthScope,
      orgId,
      healthDashboardId,
      [assetA, assetB],
      // Asked LIVE, of the ids the resolver actually produced — never against a snapshot taken
      // in `beforeAll`, which a parallel suite's committed asset invalidates mid-run.
      async (scope) => {
        if (scope.length === 0) return [];
        const rows = await fleetPool.query<{ id: string }>(
          `SELECT id FROM bms.assets WHERE id = ANY($1::uuid[]) AND organization_id <> $2`,
          [[...scope], orgId],
        );
        return rows.rows.map((row) => row.id);
      },
    );
  });

  it("drops a binding whose widget has been deleted", async () => {
    await assertDeletedWidgetDropsItsBinding(
      service,
      fleetDb,
      orgId,
      deletableDashboardId,
      deletableWidgetId,
    );
  });

  it("answers a dashboard with no catalog bindings as empty", async () => {
    await assertNoBindingsResolvesEmpty(service, orgId, emptyDashboardId);
  });
});
