import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AssetHealthService } from "../asset-health/asset-health.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { MetricCatalogService } from "./metric-catalog.service";
import {
  byLocationListsL1ThenL2WithStringCoverage,
  byLocationShowsASiteWithNoMetersAsZeroOverZero,
  callerScopeIntersectsTheTable,
  l1AvgOnTheSameDashboardIsFifteen,
  l1SumIsThirtyWithFullCoverage,
  measuredPointUsesTheFifteenMinuteBound,
  moneyTileCarriesTheOrganizationCurrency,
  olderMetricEmitsNoCoverageOrCurrency,
  quantityTileCarriesNoCurrency,
  unparseableBindingIsSkippedNotThrown,
  wideSumExcludesTheStaleAssetButCountsIt,
  type RollupFixture,
} from "./sustainability-rollup.integration.spec";

/**
 * `E4.2` U4 — Vitest entry point for the sustainability roll-up. Assertions live in the sibling
 * `.integration.spec.ts` (ADR 0014); this file owns the database lifecycle and the fixture.
 *
 * **The fixture builds its own template, locations, assets, samples and dashboards, all with a
 * per-run suffix, and deletes them in `afterAll`.** No new organization (the
 * `metric-catalog.integration.test.ts` reasoning): every organization-wide read passes the
 * fixture's four asset ids as the caller's readable set, so the numbers are its own.
 *
 * **The telemetry DELETE is bounded by time as well as `asset_id`.** `telemetry.point_values`
 * is a hypertable; a DELETE keyed by `asset_id` alone scans every chunk. Every sample here is
 * younger than one hour, so `time > now() - interval '1 hour'` confines the delete to the
 * chunks that can hold them.
 *
 * The fixture (plan U4): a published asset template with `kl_today` (derived, scheduled, 60 s)
 * and `kwh_today` (measured); assets A and B at L1 on it, C at L2 on it, D at L1 on no
 * template. Samples: `kl_today` A = 10 (now), B = 20 (now), C = 99 (now − 10 min, stale at
 * 180 s); `kwh_today` A = 5 (now − 14 min, fresh at 15 min), B = 7 (now − 16 min, stale).
 */
const connectionString = requireIntegrationDb({
  item: "E4.2",
  label: "the sustainability roll-up: freshness, coverage, currency, distinct params",
  because:
    "whether a 10-minute-old sample is excluded at a 180 s bound, whether two tiles with " +
    "different params resolve separately, and whether the currency rides only on a money " +
    "point are facts about real rows, a real lateral join and a real tenant transaction.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("E4.2 U4 — the sustainability roll-up", () => {
  let superuserPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetDb: BmsDb;
  let fixture: RollupFixture;

  let orgId = "";
  let templateId = "";
  const locationIds: string[] = [];
  const assetIds: string[] = [];
  const dashboardIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 1 } as const;
    superuserPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "E4.2 U4",
      POOL,
    );
    fleetPool = await openIntegrationPool(url, "E4.2 U4", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.2 U4",
      POOL,
    );
    fleetDb = createDb(fleetPool);

    const service = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
    );

    const org = await fleetPool.query<{ id: string; currency: string }>(
      `SELECT id, currency FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    );
    orgId = org.rows[0]?.id ?? "";
    const currency = org.rows[0]?.currency ?? "";
    if (!orgId || !currency) throw new Error("E4.2 U4: ESKOM organization not found — run pnpm db:seed");

    const domain = await fleetPool.query<{ code: string }>(
      `SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`,
    );
    const domainCode = domain.rows[0]?.code ?? "";

    const mkLocation = async (tag: string): Promise<{ id: string; code: string }> => {
      const code = `E42${tag}-${RUN}`;
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
        [orgId, code, `e42${tag.toLowerCase()}-${RUN}`, `E4.2 site ${tag} ${RUN}`],
      );
      const id = row.rows[0]?.id ?? "";
      locationIds.push(id);
      return { id, code };
    };
    const l1 = await mkLocation("L1");
    const l2 = await mkLocation("L2");

    const template = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status, published_at)
       VALUES ($1, $2, 'E4.2 U4 template', 'meter', $3, 'published', now()) RETURNING id`,
      [orgId, `e42-u4-${RUN}`, domainCode],
    );
    templateId = template.rows[0]?.id ?? "";
    await superuserPool.query(
      `INSERT INTO bms.template_points
         (organization_id, template_id, point_key, kind, formula, formula_dialect, calc_trigger, calc_interval_seconds, required)
       VALUES ($1, $2, 'kl_today', 'derived', '1', 'bms-calc-v1', 'scheduled', 60, false),
              ($1, $2, 'kwh_today', 'measured', NULL, NULL, NULL, NULL, false)`,
      [orgId, templateId],
    );

    const mkAsset = async (locationId: string, tag: string, onTemplate: boolean): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, template_id)
         VALUES ($1, $2, $3, $4, 'E4.2', $5, $6) RETURNING id`,
        [orgId, locationId, `E42-${tag}-${RUN}`, `E4.2 ${tag} ${RUN}`, domainCode, onTemplate ? templateId : null],
      );
      const id = row.rows[0]?.id ?? "";
      assetIds.push(id);
      return id;
    };
    const assetA = await mkAsset(l1.id, "A", true);
    const assetB = await mkAsset(l1.id, "B", true);
    const assetC = await mkAsset(l2.id, "C", true);
    await mkAsset(l1.id, "D", false);

    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES
         (now(), $1, 'kl_today', 10),
         (now(), $2, 'kl_today', 20),
         (now() - interval '10 minutes', $3, 'kl_today', 99),
         (now() - interval '14 minutes', $1, 'kwh_today', 5),
         (now() - interval '16 minutes', $2, 'kwh_today', 7)`,
      [assetA, assetB, assetC],
    );

    /** A dashboard with N widgets, each bound to one catalog entry with the given params. */
    const mkDashboard = async (
      tag: string,
      locationId: string | null,
      bindings: readonly { widgetType: "value_tile" | "table"; catalogKey: string; params: unknown }[],
    ): Promise<{ dashboardId: string; sourceIds: string[] }> => {
      const dash = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, `e42u4-${tag}-${RUN}`, `E4.2 U4 ${tag}`, locationId],
      );
      const dashboardId = dash.rows[0]?.id ?? "";
      dashboardIds.push(dashboardId);
      const sourceIds: string[] = [];
      for (const [index, binding] of bindings.entries()) {
        const widget = await superuserPool.query<{ id: string }>(
          `INSERT INTO bms.dashboard_widgets
             (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
           VALUES ($1, $2, $3, 0, $4, 3, 2) RETURNING id`,
          [orgId, dashboardId, binding.widgetType, index * 2],
        );
        const source = await superuserPool.query<{ id: string }>(
          `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [orgId, widget.rows[0]?.id, binding.catalogKey, JSON.stringify(binding.params)],
        );
        sourceIds.push(source.rows[0]?.id ?? "");
      }
      return { dashboardId, sourceIds };
    };

    const sum = (pointKey: string) => ({ pointKey, aggregate: "sum" });
    const l1Dash = await mkDashboard("l1", l1.id, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kl_today") },
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: { pointKey: "kl_today", aggregate: "avg" } },
    ]);
    const tableDash = await mkDashboard("table", null, [
      { widgetType: "table", catalogKey: "sustainability.by_location", params: sum("kl_today") },
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kl_today") },
    ]);
    const kwhDash = await mkDashboard("kwh", null, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kwh_today") },
    ]);
    const moneyDash = await mkDashboard("money", null, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("water_cost_today") },
      { widgetType: "table", catalogKey: "sustainability.by_location", params: sum("water_cost_today") },
      { widgetType: "value_tile", catalogKey: "alarms.active.count", params: {} },
      // Hand-inserted past the write schema: the resolver must skip it, not throw.
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: { pointKey: "nope", aggregate: "sum" } },
    ]);
    // `nope` is not a catalog code, so the write path would have refused it (U3); the row is
    // here to prove the READ path tolerates one. Its params DO parse — what fails is a second,
    // separate row whose params are shaped wrong.
    const brokenWidget = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_widgets (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
       VALUES ($1, $2, 'value_tile', 3, 0, 3, 2) RETURNING id`,
      [orgId, moneyDash.dashboardId],
    );
    const broken = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
       VALUES ($1, $2, 'sustainability.total', '{"pointKey": "kl_today"}') RETURNING id`,
      [orgId, brokenWidget.rows[0]?.id],
    );

    fixture = {
      service,
      orgId,
      currency,
      l1Code: l1.code,
      l2Code: l2.code,
      assetA,
      fixtureAssets: [...assetIds],
      l1DashboardId: l1Dash.dashboardId,
      l1SumSourceId: l1Dash.sourceIds[0] ?? "",
      l1AvgSourceId: l1Dash.sourceIds[1] ?? "",
      wideTableDashboardId: tableDash.dashboardId,
      wideTableSourceId: tableDash.sourceIds[0] ?? "",
      wideTotalSourceId: tableDash.sourceIds[1] ?? "",
      wideKwhDashboardId: kwhDash.dashboardId,
      wideKwhSourceId: kwhDash.sourceIds[0] ?? "",
      wideMoneyDashboardId: moneyDash.dashboardId,
      wideMoneySourceId: moneyDash.sourceIds[0] ?? "",
      wideMoneyTableSourceId: moneyDash.sourceIds[1] ?? "",
      wideMoneyAlarmsSourceId: moneyDash.sourceIds[2] ?? "",
      nopeSourceId: broken.rows[0]?.id ?? "",
    };
  }, 60_000);

  afterAll(async () => {
    // Guarded on truthiness: `beforeAll` can fail partway (the metric-catalog suite's lesson).
    for (const id of dashboardIds.filter(Boolean)) {
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [id]);
    }
    const assets = assetIds.filter(Boolean);
    if (assets.length > 0) {
      await superuserPool.query(
        `DELETE FROM telemetry.point_values
          WHERE asset_id = ANY($1::uuid[]) AND time > now() - interval '1 hour'`,
        [assets],
      );
      await superuserPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])`, [assets]);
      await superuserPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [assets]);
    }
    if (templateId) {
      // template_points cascade with the template.
      await superuserPool.query(`DELETE FROM bms.asset_templates WHERE id = $1`, [templateId]);
    }
    const locs = locationIds.filter(Boolean);
    if (locs.length > 0) {
      await superuserPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [locs]);
    }
    await Promise.all([superuserPool, fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("sums the L1 dashboard's two fresh assets to 30 with coverage 2/2", async () => {
    await l1SumIsThirtyWithFullCoverage(fixture);
  });

  it("averages the second tile on the same dashboard to 15 (distinct params resolve separately)", async () => {
    await l1AvgOnTheSameDashboardIsFifteen(fixture);
  });

  it("excludes the 10-minute-old sample at a 180 s bound and counts it: 30 with 2/3", async () => {
    await wideSumExcludesTheStaleAssetButCountsIt(fixture);
  });

  it("bounds a measured point at 15 minutes: 5 with 1/3", async () => {
    await measuredPointUsesTheFifteenMinuteBound(fixture);
  });

  it("lists by_location rows L1 then L2 with string coverage", async () => {
    await byLocationListsL1ThenL2WithStringCoverage(fixture);
  });

  it("shows a site with assets and no carrying asset as null / 0/0", async () => {
    await byLocationShowsASiteWithNoMetersAsZeroOverZero(fixture);
  });

  it("carries the organization's currency on a money point", async () => {
    await moneyTileCarriesTheOrganizationCurrency(fixture);
  });

  it("carries currency: null on a quantity point", async () => {
    await quantityTileCarriesNoCurrency(fixture);
  });

  it("skips a binding whose stored params fail the write schema, without throwing", async () => {
    await unparseableBindingIsSkippedNotThrown(fixture);
  });

  it("emits neither coverage nor currency on alarms.active.count", async () => {
    await olderMetricEmitsNoCoverageOrCurrency(fixture);
  });

  it("intersects the caller's readable assets with the table's scope", async () => {
    await callerScopeIntersectsTheTable(fixture);
  });
});
