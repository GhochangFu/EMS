import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import { MAX_DATASET_ROWS } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { MetricCatalogService } from "./metric-catalog.service";
import {
  intakeTileAtL1IsTenWithOneOfOne,
  intakeTableGivesL1TenOverOneOfOne,
  intakeTableKeepsL2AsARowAtZeroOverZero,
  dischargeTableGivesL1NullOverZeroOfZero,
  byLocationListsL1ThenL2WithStringCoverage,
  byLocationShowsASiteWithNoMetersAsZeroOverZero,
  callerScopeIntersectsTheTable,
  inactiveAssetIsNotCarrying,
  l1AvgOnTheSameDashboardIsFifteen,
  l1SumIsThirtyWithFullCoverage,
  measuredPointUsesTheFifteenMinuteBound,
  moneyTileCarriesTheOrganizationCurrency,
  noUnitNonMoneyTileCarriesNoCurrency,
  olderMetricEmitsNoCoverageOrCurrency,
  quantityTileCarriesNoCurrency,
  unparseableBindingIsSkippedNotThrown,
  wideSumExcludesTheStaleAssetButCountsIt,
  assetScopedDashboardRollsUpItsOneAsset,
  byLocationUnderTheCapIsNotTruncated,
  byLocationOverTheCapIsTruncated,
  balanceRowsAreL1L3L4,
  inactiveRoledAssetAloneMakesNoRow,
  internalOnlyL5IsNoRowBesideL1,
  l4ConsumedIsNullWithAPreV5Discharge,
  l4CoverageIsOneOfOne,
  l6ByLocationListsL6,
  byLocationBesideTheBalanceStillListsL2,
  callerScopeOfWAloneIsOneRow,
  l1ConsumedIsFortyThree,
  l1CoverageIsThreeOfThree,
  l1DischargeIsSeven,
  l1IntakeIsFifty,
  l1ReuseIsEleven,
  l3ConsumedIsNullWithAStaleDischarge,
  l3CoverageIsOneOfTwo,
  thisMonthKeepsL1AsANullRow,
  type BalanceFixture,
  type CapFixture,
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
 * The fixture (plan U4): a published asset template with `kl_today` (derived, scheduled, 60 s,
 * over the self-reference formula `{kl_today}` — the U9 fixture below gives the reason)
 * and `kwh_today` (measured); assets A and B at L1 on it, C at L2 on it, D at L1 on no
 * template, E at L1 on it and INACTIVE (sweep). Samples: `kl_today` A = 10 (now), B = 20
 * (now), C = 99 (now − 10 min, stale at 180 s), E = 40 (now, and excluded as inactive);
 * `kwh_today` A = 5 (now − 14 min, fresh at 15 min), B = 7 (now − 16 min, stale).
 *
 * `E4.3` U4 (ADR 0073 decision 2): A's `water_balance_role` is `intake`, B's `internal`, C's
 * `NULL`, so a `balanceRole` binding and the unfiltered one read the SAME rows — the unfiltered
 * L1 sum staying 30 with 2/2 is the double-count control for the filtered 10 with 1/1.
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
       VALUES ($1, $2, 'kl_today', 'derived', '{kl_today}', 'bms-calc-v1', 'scheduled', 60, false),
              ($1, $2, 'kwh_today', 'measured', NULL, NULL, NULL, NULL, false)`,
      [orgId, templateId],
    );

    const mkAsset = async (
      locationId: string,
      tag: string,
      onTemplate: boolean,
      active = true,
      waterBalanceRole: string | null = null,
    ): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.assets
           (organization_id, location_id, code, name, site_name, domain, template_id, active, water_balance_role)
         VALUES ($1, $2, $3, $4, 'E4.2', $5, $6, $7, $8) RETURNING id`,
        [
          orgId,
          locationId,
          `E42-${tag}-${RUN}`,
          `E4.2 ${tag} ${RUN}`,
          domainCode,
          onTemplate ? templateId : null,
          active,
          waterBalanceRole,
        ],
      );
      const id = row.rows[0]?.id ?? "";
      assetIds.push(id);
      return id;
    };
    const assetA = await mkAsset(l1.id, "A", true, true, "intake");
    const assetB = await mkAsset(l1.id, "B", true, true, "internal");
    const assetC = await mkAsset(l2.id, "C", true);
    await mkAsset(l1.id, "D", false);
    // E (sweep): INACTIVE, on the template at L1, with a FRESH sample — a decommissioned meter
    // that must be neither a denominator nor a term on the L1 dashboard (the location arm of
    // `resolveAssetScope` does not filter `active`; the carrying query must).
    const assetE = await mkAsset(l1.id, "E", true, false);

    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES
         (now(), $1, 'kl_today', 10),
         (now(), $2, 'kl_today', 20),
         (now() - interval '10 minutes', $3, 'kl_today', 99),
         (now() - interval '14 minutes', $1, 'kwh_today', 5),
         (now() - interval '16 minutes', $2, 'kwh_today', 7),
         (now(), $4, 'kl_today', 40)`,
      [assetA, assetB, assetC, assetE],
    );

    /** A dashboard with N widgets, each bound to one catalog entry with the given params. */
    const mkDashboard = async (
      tag: string,
      locationId: string | null,
      assetId: string | null,
      bindings: readonly { widgetType: "value_tile" | "table"; catalogKey: string; params: unknown }[],
    ): Promise<{ dashboardId: string; sourceIds: string[] }> => {
      const dash = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, location_id, asset_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, `e42u4-${tag}-${RUN}`, `E4.2 U4 ${tag}`, locationId, assetId],
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
    const l1Dash = await mkDashboard("l1", l1.id, null, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kl_today") },
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: { pointKey: "kl_today", aggregate: "avg" } },
    ]);
    const tableDash = await mkDashboard("table", null, null, [
      { widgetType: "table", catalogKey: "sustainability.by_location", params: sum("kl_today") },
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kl_today") },
    ]);
    const kwhDash = await mkDashboard("kwh", null, null, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kwh_today") },
    ]);
    const moneyDash = await mkDashboard("money", null, null, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("water_cost_today") },
      { widgetType: "table", catalogKey: "sustainability.by_location", params: sum("water_cost_today") },
      { widgetType: "value_tile", catalogKey: "alarms.active.count", params: {} },
      // Hand-inserted past the write schema: the resolver must skip it, not throw.
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: { pointKey: "nope", aggregate: "sum" } },
      // Appended (the source ids above are positional): unit `""` and NOT money — no currency.
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: { pointKey: "pf", aggregate: "avg" } },
    ]);
    // `E4.3` U4 — the role-filtered bindings, on dashboards of their own so every earlier
    // source id stays where it was.
    const role = (balanceRole: string) => ({ pointKey: "kl_today", aggregate: "sum", balanceRole });
    const roleL1Dash = await mkDashboard("role-l1", l1.id, null, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: role("intake") },
    ]);
    const roleTableDash = await mkDashboard("role-table", null, null, [
      { widgetType: "table", catalogKey: "sustainability.by_location", params: role("intake") },
      { widgetType: "table", catalogKey: "sustainability.by_location", params: role("discharge") },
    ]);
    const assetDash = await mkDashboard("asset", null, assetA, [
      { widgetType: "value_tile", catalogKey: "sustainability.total", params: sum("kl_today") },
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
      widePfSourceId: moneyDash.sourceIds[4] ?? "",
      nopeSourceId: broken.rows[0]?.id ?? "",
      assetScopedDashboardId: assetDash.dashboardId,
      assetScopedSourceId: assetDash.sourceIds[0] ?? "",
      roleL1DashboardId: roleL1Dash.dashboardId,
      roleL1IntakeSourceId: roleL1Dash.sourceIds[0] ?? "",
      roleTableDashboardId: roleTableDash.dashboardId,
      roleTableIntakeSourceId: roleTableDash.sourceIds[0] ?? "",
      roleTableDischargeSourceId: roleTableDash.sourceIds[1] ?? "",
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

  it("does not count the inactive asset E at L1 as carrying, nor its fresh 40 as a term", async () => {
    await inactiveAssetIsNotCarrying(fixture);
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

  it("carries currency: null on pf — unit \"\" but not a listed money code", async () => {
    await noUnitNonMoneyTileCarriesNoCurrency(fixture);
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

  it("rolls up an asset-scoped dashboard over its one asset: 10 with 1/1", async () => {
    await assetScopedDashboardRollsUpItsOneAsset(fixture);
  });

  it("reports truncated: false for two locations (the cap control)", async () => {
    await byLocationUnderTheCapIsNotTruncated(fixture);
  });

  it("narrows the L1 sum to the intake asset: 10 with 1/1 (E4.3)", async () => {
    await intakeTileAtL1IsTenWithOneOfOne(fixture);
  });

  it("narrows the by_location L1 row to the intake asset: 10, \"1/1\" (E4.3)", async () => {
    await intakeTableGivesL1TenOverOneOfOne(fixture);
  });

  it("keeps L2 as a by_location row under a role filter: null, \"0/0\" (E4.3)", async () => {
    await intakeTableKeepsL2AsARowAtZeroOverZero(fixture);
  });

  it("answers null, \"0/0\" at L1 for a role no asset there carries (E4.3)", async () => {
    await dischargeTableGivesL1NullOverZeroOfZero(fixture);
  });
});

/**
 * The cap fixture (review): 201 per-run locations, each with one template-less asset, so every
 * row is `null` / "0/0" and no telemetry is needed. Two multi-row INSERTs; the read is scoped to
 * the 201 assets through `readableAssetIds`, so the other fixture's locations do not join.
 */
describe.skipIf(!connectionString)("E4.2 U4 — the by_location cap is reached", () => {
  const COUNT = MAX_DATASET_ROWS + 1;
  let superuserPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fixture: CapFixture;
  let orgId = "";
  let dashboardId = "";
  let locationIds: string[] = [];
  let assetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 1 } as const;
    superuserPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "E4.2 U4 cap",
      POOL,
    );
    fleetPool = await openIntegrationPool(url, "E4.2 U4 cap", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.2 U4 cap",
      POOL,
    );
    const fleetDb = createDb(fleetPool);
    const service = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
    );

    const org = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    );
    orgId = org.rows[0]?.id ?? "";
    if (!orgId) throw new Error("E4.2 U4 cap: ESKOM organization not found — run pnpm db:seed");
    const domain = await fleetPool.query<{ code: string }>(
      `SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`,
    );
    const domainCode = domain.rows[0]?.code ?? "";

    const tags = Array.from({ length: COUNT }, (_, i) => String(i).padStart(3, "0"));
    const locs = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       SELECT $1, 'E42C' || t || '-' || $2, 'e42c' || t || '-' || $2, 'E4.2 cap ' || t, 'csmoc', 0, 0
         FROM unnest($3::text[]) AS t
       RETURNING id`,
      [orgId, RUN, tags],
    );
    locationIds = locs.rows.map((row) => row.id);
    const assets = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       SELECT $1, l.id, 'E42C-' || l.code, 'E4.2 cap asset', 'E4.2', $2
         FROM bms.locations l WHERE l.id = ANY($3::uuid[])
       RETURNING id`,
      [orgId, domainCode, locationIds],
    );
    assetIds = assets.rows.map((row) => row.id);
    if (locationIds.length !== COUNT || assetIds.length !== COUNT) {
      throw new Error(`E4.2 U4 cap: expected ${COUNT} locations and assets`);
    }

    const dash = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'E4.2 U4 cap')
       RETURNING id`,
      [orgId, `e42u4-cap-${RUN}`],
    );
    dashboardId = dash.rows[0]?.id ?? "";
    const widget = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_widgets (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
       VALUES ($1, $2, 'table', 0, 0, 6, 4) RETURNING id`,
      [orgId, dashboardId],
    );
    const source = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
       VALUES ($1, $2, 'sustainability.by_location', '{"pointKey": "kl_today", "aggregate": "sum"}')
       RETURNING id`,
      [orgId, widget.rows[0]?.id],
    );
    fixture = { service, orgId, dashboardId, sourceId: source.rows[0]?.id ?? "", assetIds };
  }, 120_000);

  afterAll(async () => {
    if (dashboardId) await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [dashboardId]);
    if (assetIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [assetIds]);
    }
    if (locationIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [locationIds]);
    }
    await Promise.all([superuserPool, fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("returns exactly MAX_DATASET_ROWS rows and truncated: true over 201 locations", async () => {
    await byLocationOverTheCapIsTruncated(fixture);
  });
});

/**
 * `E4.3` U9 — the `water.balance` fixture (ADR 0073 decision 3; plan U9). Its own template,
 * carrying `kl_today` and `outlet_kl_today` (both derived, scheduled, 60 s), and six per-run
 * locations: L1 holds W intake, S reuse, E discharge and R internal; L2 holds N with a `NULL`
 * role; L3 holds I intake and D discharge, D's one sample 10 minutes old (stale at 180 s).
 *
 * The PR 2 review added three: L4 holds P intake (`kl_today` 30) and Q discharge pinned to a
 * second, PRE-v5 template that carries a measured `kl_today` and no `outlet_kl_today` (F1);
 * L5 holds T internal alone (F6, the row rule); L6 holds V intake, INACTIVE, with a fresh
 * `kl_today` 60 (F3). V is read through a dashboard scoped to L6, because the organization arm
 * of `resolveAssetScope` already drops inactive assets — only a location scope reaches V, so
 * only there can `readBalanceLocations`' own `a.active` decide.
 *
 * Every row carries the `E43`/`e43` per-run prefix and is deleted in `afterAll`; nothing here
 * runs inside a transaction, so nothing depends on a rollback. The telemetry DELETE is bounded
 * by time for the hypertable reason the first fixture states.
 *
 * **Each derived point's formula reads the point itself, on purpose.** A constant formula
 * (`'1'`, as the first fixture wrote until the PR 2 review) is a live definition to the
 * running API's scheduled calc sweep, which evaluates it within a minute of its cache refresh
 * and writes a fresh `1` over the fixture's samples. Observed in U9: the API log carried `calc write` lines for these
 * fixture points, and one run reddened both L3 claims (D's stale sample turned fresh) under a
 * mutation that cannot touch L3. A self-reference is refused by `toActiveDefinition` at load
 * (`self_reference`), so no host ever writes these points, while `readRollupRows` still reads
 * them as scheduled derived points with a 180 s bound.
 */
describe.skipIf(!connectionString)("E4.3 U9 — the water.balance resolver", () => {
  let superuserPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fixture: BalanceFixture;
  let orgId = "";
  const templateIds: string[] = [];
  const dashboardIds: string[] = [];
  const locationIds: string[] = [];
  const assetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 1 } as const;
    superuserPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "E4.3 U9",
      POOL,
    );
    fleetPool = await openIntegrationPool(url, "E4.3 U9", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.3 U9",
      POOL,
    );
    const fleetDb = createDb(fleetPool);
    const service = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
    );

    const org = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    );
    orgId = org.rows[0]?.id ?? "";
    if (!orgId) throw new Error("E4.3 U9: ESKOM organization not found — run pnpm db:seed");
    const domain = await fleetPool.query<{ code: string }>(
      `SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`,
    );
    const domainCode = domain.rows[0]?.code ?? "";

    const mkLocation = async (tag: string): Promise<{ id: string; code: string }> => {
      const code = `E43${tag}-${RUN}`;
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
        [orgId, code, `e43${tag.toLowerCase()}-${RUN}`, `E4.3 site ${tag} ${RUN}`],
      );
      const id = row.rows[0]?.id ?? "";
      locationIds.push(id);
      return { id, code };
    };
    const l1 = await mkLocation("L1");
    const l2 = await mkLocation("L2");
    const l3 = await mkLocation("L3");
    const l4 = await mkLocation("L4");
    const l5 = await mkLocation("L5");
    const l6 = await mkLocation("L6");

    const template = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status, published_at)
       VALUES ($1, $2, 'E4.3 U9 template', 'meter', $3, 'published', now()) RETURNING id`,
      [orgId, `e43-u9-${RUN}`, domainCode],
    );
    const templateId = template.rows[0]?.id ?? "";
    templateIds.push(templateId);
    // F1 — a PRE-v5 water template: `kl_today` (measured, so no calc sweep writes it) and no
    // `outlet_kl_today`, so `readRollupRows` returns no discharge row for an asset on it.
    const preV5 = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status, published_at)
       VALUES ($1, $2, 'E4.3 pre-v5 template', 'meter', $3, 'published', now()) RETURNING id`,
      [orgId, `e43-u9p-${RUN}`, domainCode],
    );
    const preV5TemplateId = preV5.rows[0]?.id ?? "";
    templateIds.push(preV5TemplateId);
    await superuserPool.query(
      `INSERT INTO bms.template_points (organization_id, template_id, point_key, kind, required)
       VALUES ($1, $2, 'kl_today', 'measured', false)`,
      [orgId, preV5TemplateId],
    );
    await superuserPool.query(
      `INSERT INTO bms.template_points
         (organization_id, template_id, point_key, kind, formula, formula_dialect, calc_trigger, calc_interval_seconds, required)
       VALUES ($1, $2, 'kl_today', 'derived', '{kl_today}', 'bms-calc-v1', 'scheduled', 60, false),
              ($1, $2, 'outlet_kl_today', 'derived', '{outlet_kl_today}', 'bms-calc-v1', 'scheduled', 60, false)`,
      [orgId, templateId],
    );

    const mkAsset = async (
      locationId: string,
      tag: string,
      role: string | null,
      onTemplate = templateId,
      active = true,
    ): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.assets
           (organization_id, location_id, code, name, site_name, domain, template_id, water_balance_role, active)
         VALUES ($1, $2, $3, $4, 'E4.3', $5, $6, $7, $8) RETURNING id`,
        [orgId, locationId, `E43-${tag}-${RUN}`, `E4.3 ${tag} ${RUN}`, domainCode, onTemplate, role, active],
      );
      const id = row.rows[0]?.id ?? "";
      assetIds.push(id);
      return id;
    };
    const w = await mkAsset(l1.id, "W", "intake");
    const s = await mkAsset(l1.id, "S", "reuse");
    const e = await mkAsset(l1.id, "E", "discharge");
    const r = await mkAsset(l1.id, "R", "internal");
    await mkAsset(l2.id, "N", null);
    const i = await mkAsset(l3.id, "I", "intake");
    const d = await mkAsset(l3.id, "D", "discharge");
    const p = await mkAsset(l4.id, "P", "intake");
    await mkAsset(l4.id, "Q", "discharge", preV5TemplateId);
    await mkAsset(l5.id, "T", "internal");
    const v = await mkAsset(l6.id, "V", "intake", templateId, false);

    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES
         (now(), $1, 'kl_today', 50),
         (now(), $2, 'outlet_kl_today', 11),
         (now(), $3, 'outlet_kl_today', 7),
         (now(), $4, 'outlet_kl_today', 5),
         (now(), $5, 'kl_today', 20),
         (now() - interval '10 minutes', $6, 'outlet_kl_today', 3),
         (now(), $7, 'kl_today', 30),
         (now(), $8, 'kl_today', 60)`,
      [w, s, e, r, i, d, p, v],
    );

    /** A dashboard of `table` widgets, one per binding; `locationId` scopes it to one site. */
    const mkDashboard = async (
      tag: string,
      locationId: string | null,
      bindings: readonly { catalogKey: string; params: unknown }[],
    ): Promise<{ dashboardId: string; sourceIds: string[] }> => {
      const dash = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, `e43u9-${tag}-${RUN}`, `E4.3 U9 ${tag}`, locationId],
      );
      const dashboardId = dash.rows[0]?.id ?? "";
      dashboardIds.push(dashboardId);
      const sourceIds: string[] = [];
      for (const [index, binding] of bindings.entries()) {
        const widget = await superuserPool.query<{ id: string }>(
          `INSERT INTO bms.dashboard_widgets
             (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
           VALUES ($1, $2, 'table', 0, $3, 6, 4) RETURNING id`,
          [orgId, dashboardId, index * 4],
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
    const today = { catalogKey: "water.balance", params: { period: "today" } };
    const byLocation = {
      catalogKey: "sustainability.by_location",
      params: { pointKey: "kl_today", aggregate: "sum" },
    };
    const orgDash = await mkDashboard("balance", null, [
      today,
      { catalogKey: "water.balance", params: { period: "this_month" } },
      byLocation,
    ]);
    const l6Dash = await mkDashboard("l6", l6.id, [today, byLocation]);

    fixture = {
      service,
      orgId,
      l1Code: l1.code,
      l2Code: l2.code,
      l3Code: l3.code,
      l4Code: l4.code,
      l5Code: l5.code,
      l6Code: l6.code,
      assetW: w,
      fixtureAssets: [...assetIds],
      dashboardId: orgDash.dashboardId,
      todaySourceId: orgDash.sourceIds[0] ?? "",
      thisMonthSourceId: orgDash.sourceIds[1] ?? "",
      byLocationSourceId: orgDash.sourceIds[2] ?? "",
      l6DashboardId: l6Dash.dashboardId,
      l6TodaySourceId: l6Dash.sourceIds[0] ?? "",
      l6ByLocationSourceId: l6Dash.sourceIds[1] ?? "",
    };
  }, 60_000);

  afterAll(async () => {
    // Guarded on truthiness: `beforeAll` can fail partway. Widgets and sources cascade with the
    // dashboard; template points with the template. Assets go before the templates (FK).
    const dashboards = dashboardIds.filter(Boolean);
    if (dashboards.length > 0) {
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboards]);
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
    const templates = templateIds.filter(Boolean);
    if (templates.length > 0) {
      await superuserPool.query(`DELETE FROM bms.asset_templates WHERE id = ANY($1::uuid[])`, [templates]);
    }
    const locs = locationIds.filter(Boolean);
    if (locs.length > 0) {
      await superuserPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [locs]);
    }
    await Promise.all([superuserPool, fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("lists balance rows L1, L3, L4 — L2 (no role) and L5 (internal only) absent", async () => {
    await balanceRowsAreL1L3L4(fixture);
  });

  it("still lists L1 to L5 in the by_location table on the same dashboard (the control)", async () => {
    await byLocationBesideTheBalanceStillListsL2(fixture);
  });

  it("reads L1 intake as 50 (kl_today over the intake asset)", async () => {
    await l1IntakeIsFifty(fixture);
  });

  it("reads L1 reuse as 11 (outlet_kl_today over the reuse asset)", async () => {
    await l1ReuseIsEleven(fixture);
  });

  it("reads L1 discharge as 7 (the internal asset's 5 is no term)", async () => {
    await l1DischargeIsSeven(fixture);
  });

  it("reads L1 consumed as 43: intake − discharge, reuse not added (ADR 0073 decision 3)", async () => {
    await l1ConsumedIsFortyThree(fixture);
  });

  it("reads L1 coverage as \"3/3\": the internal asset is not counted (Q9)", async () => {
    await l1CoverageIsThreeOfThree(fixture);
  });

  it("reads L3 consumed as null: its discharge asset is stale (Q8)", async () => {
    await l3ConsumedIsNullWithAStaleDischarge(fixture);
  });

  it("reads L3 coverage as \"1/2\"", async () => {
    await l3CoverageIsOneOfTwo(fixture);
  });

  it("keeps L1 as an all-null \"0/0\" row for a period no template point carries", async () => {
    await thisMonthKeepsL1AsANullRow(fixture);
  });

  it("intersects the caller's scope: W alone gives L1 {50, null, null, 50, \"1/1\"}", async () => {
    await callerScopeOfWAloneIsOneRow(fixture);
  });

  it("reads L4 as intake 30, consumed null: its discharge asset is on a pre-v5 template (F1)", async () => {
    await l4ConsumedIsNullWithAPreV5Discharge(fixture);
  });

  it("reads L4 coverage as \"1/1\": the non-carrying discharge asset is no denominator", async () => {
    await l4CoverageIsOneOfOne(fixture);
  });

  it("makes no row for L5, whose only asset is internal, beside the L1 row (F6)", async () => {
    await internalOnlyL5IsNoRowBesideL1(fixture);
  });

  it("makes no row for L6 on its location dashboard: its one roled asset is inactive (F3)", async () => {
    await inactiveRoledAssetAloneMakesNoRow(fixture);
  });

  it("lists L6 in by_location on the same L6 dashboard: the inactive asset IS in scope", async () => {
    await l6ByLocationListsL6(fixture);
  });
});
