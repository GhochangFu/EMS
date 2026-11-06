import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertActiveAndCriticalPairOnOneTile,
  assertPueRatioReadsThePairOrNull,
  assertSitesLiveCountsLocations,
} from "./metric-catalog-estate.integration.spec";
import { MetricCatalogService } from "./metric-catalog.service";

/**
 * `F4.317` (ADR 0112) — Vitest entry point for the organization strip's catalog keys.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the database lifecycle and
 * the fixture.
 *
 * The `metric-catalog.integration.test.ts` rules hold here: ESKOM rows with a per-run suffix
 * (`F4.65`), no new organization, every read scoped to the fixture's own asset ids, every row
 * deleted by id in `afterAll`. The telemetry delete is bounded by `asset_id` and by time.
 *
 * The fixture: locations L1 and L2. A1 and A2 at L1, B1 at L2 — A1 reports (its sample is written
 * inside the `it()`, a moment before the read, so it is inside the 150 s window), A2 and B1
 * never do. P at L1 is an incomer with `site_kw` 150 and `it_kw` 100. A2 holds two open critical
 * alarms, one open warning and one cleared critical.
 */
const connectionString = requireIntegrationDb({
  item: "F4.317",
  label: "the organization strip's catalog keys (sites live, PUE, critical alarms)",
  because:
    "whether two assets at one location count as one site, whether a location admin's tile " +
    "counts only its own location, and whether the critical count reads the severity tone are " +
    "facts about real rows, the reporting CTE and a real tenant transaction.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F4.317 — the organization strip's catalog keys", () => {
  let superuserPool: pg.Pool;
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let service: MetricCatalogService;

  let orgId = "";
  const locationIds: string[] = [];
  const assetIds: string[] = [];
  const dashboardIds: string[] = [];
  let assetA1 = "";
  let assetA2 = "";
  let assetB1 = "";
  let assetP = "";

  const tiles: Record<"sites" | "pue" | "alarms", { dashboardId: string; widgetId: string }> = {
    sites: { dashboardId: "", widgetId: "" },
    pue: { dashboardId: "", widgetId: "" },
    alarms: { dashboardId: "", widgetId: "" },
  };

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 1 } as const;
    superuserPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "F4.317 catalog",
      POOL,
    );
    fleetPool = await openIntegrationPool(url, "F4.317 catalog", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.317 catalog",
      POOL,
    );
    const fleetDb = createDb(fleetPool);
    // `accessControl` is never reached: this suite drives `resolveForDashboard`.
    service = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
      fleetPool,
    );

    const org = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    );
    orgId = org.rows[0]?.id ?? "";
    if (!orgId) throw new Error("F4.317: ESKOM organization not found — run pnpm db:seed");
    const domain = await fleetPool.query<{ code: string }>(
      `SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`,
    );
    const domainCode = domain.rows[0]?.code ?? "";

    const mkLocation = async (tag: string): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $3, $4, 'csmoc', 0, 0) RETURNING id`,
        [orgId, `F4317${tag}-${RUN}`, `f4317${tag.toLowerCase()}-${RUN}`, `F4.317 site ${tag} ${RUN}`],
      );
      const id = row.rows[0]?.id ?? "";
      locationIds.push(id);
      return id;
    };
    const l1 = await mkLocation("L1");
    const l2 = await mkLocation("L2");

    const mkAsset = async (locationId: string, tag: string): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        // Each asset its own `site_name`: a resolver counting site names would read three sites.
        [orgId, locationId, `F4317-${tag}-${RUN}`, `F4.317 ${tag} ${RUN}`, `F4.317 ${tag}`, domainCode],
      );
      const id = row.rows[0]?.id ?? "";
      assetIds.push(id);
      return id;
    };
    assetA1 = await mkAsset(l1, "A1");
    assetA2 = await mkAsset(l1, "A2");
    assetB1 = await mkAsset(l2, "B1");
    assetP = await mkAsset(l1, "P");

    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
       VALUES (now(), $1, 'site_kw', 150), (now(), $1, 'it_kw', 100)`,
      [assetP],
    );

    const severities = await fleetPool.query<{ code: string; tone: string }>(
      `SELECT code, tone FROM bms.alarm_severities ORDER BY rank`,
    );
    const criticalCode = severities.rows.find((row) => row.tone === "critical")?.code;
    const otherCode = severities.rows.find((row) => row.tone !== "critical")?.code;
    if (!criticalCode || !otherCode) {
      throw new Error("F4.317: bms.alarm_severities needs a critical and a non-critical tone — run pnpm db:seed");
    }
    const mkAlarm = async (severity: string, cleared: boolean, tag: string): Promise<void> => {
      await superuserPool.query(
        `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
         VALUES ($1, $2, $3, $4, now(), CASE WHEN $5::boolean THEN now() END)`,
        [orgId, assetA2, severity, `F4.317 ${tag} ${RUN}`, cleared],
      );
    };
    await mkAlarm(criticalCode, false, "crit-1");
    await mkAlarm(criticalCode, false, "crit-2");
    await mkAlarm(otherCode, false, "other");
    await mkAlarm(criticalCode, true, "crit-cleared");

    /** An organization-wide dashboard with one `value_tile` bound to `catalogKeys`. */
    const mkTile = async (tag: string, catalogKeys: readonly string[]) => {
      const dash = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, `f4317-${tag}-${RUN}`, `F4.317 ${tag} ${RUN}`],
      );
      const dashboardId = dash.rows[0]?.id ?? "";
      dashboardIds.push(dashboardId);
      const widget = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_widgets
           (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, 'value_tile', 0, 0, 3, 2) RETURNING id`,
        [orgId, dashboardId],
      );
      const widgetId = widget.rows[0]?.id ?? "";
      for (const catalogKey of catalogKeys) {
        await superuserPool.query(
          `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key)
           VALUES ($1, $2, $3)`,
          [orgId, widgetId, catalogKey],
        );
      }
      return { dashboardId, widgetId };
    };
    tiles.sites = await mkTile("sites", ["sites.live.count"]);
    tiles.pue = await mkTile("pue", ["pue.ratio"]);
    tiles.alarms = await mkTile("alarms", ["alarms.active.count", "alarms.critical.count"]);
  }, 60_000);

  afterAll(async () => {
    // Guarded on truthiness: a `beforeAll` that failed partway must not bury its error under a
    // cleanup error (`metric-catalog.integration.test.ts` measured that).
    for (const id of dashboardIds.filter(Boolean)) {
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [id]);
    }
    const ids = assetIds.filter(Boolean);
    if (ids.length > 0) {
      await superuserPool.query(
        `DELETE FROM telemetry.point_values
          WHERE asset_id = ANY($1::uuid[]) AND time > now() - interval '3 days'`,
        [ids],
      );
      await superuserPool.query(`DELETE FROM bms.alarms WHERE asset_id = ANY($1::uuid[])`, [ids]);
      await superuserPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [ids]);
    }
    const locations = locationIds.filter(Boolean);
    if (locations.length > 0) {
      await superuserPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [locations]);
    }
    await Promise.all([superuserPool, fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("sites.live.count counts locations: two at L1 and one at L2, L1 reporting → 1 of 2", async () => {
    // Written here, a moment before the read, so it is inside the 150 s reporting window.
    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
       VALUES (now() - make_interval(secs => 1), $1, 'temp_c', 21)`,
      [assetA1],
    );
    await assertSitesLiveCountsLocations(
      service,
      orgId,
      tiles.sites.dashboardId,
      tiles.sites.widgetId,
      [assetA1, assetA2, assetB1],
      { value: 1, fresh: 1, carrying: 2 },
    );
  });

  it("sites.live.count for a location admin holding only L2 is 0 of 1", async () => {
    await assertSitesLiveCountsLocations(
      service,
      orgId,
      tiles.sites.dashboardId,
      tiles.sites.widgetId,
      [assetB1],
      { value: 0, fresh: 0, carrying: 1 },
    );
  });

  it("pue.ratio is 150 / 100 over the incomer, and null with no pair in scope", async () => {
    await assertPueRatioReadsThePairOrNull(
      service,
      orgId,
      tiles.pue.dashboardId,
      tiles.pue.widgetId,
      [assetP, assetA1],
      1.5,
      [assetA1, assetA2],
    );
  });

  it("one tile binds alarms.active.count and alarms.critical.count: 3 open, 2 critical (Q1b)", async () => {
    await assertActiveAndCriticalPairOnOneTile(
      service,
      orgId,
      tiles.alarms.dashboardId,
      tiles.alarms.widgetId,
      [assetA1, assetA2, assetB1],
      3,
      2,
    );
  });
});
