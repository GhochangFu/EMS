import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertActiveAndCriticalPairOnOneTile,
  assertPriorOpenAlarmsEdges,
  assertPriorOnlyWhenAsked,
  assertPueRatioReadsThePairOrNull,
  assertSitesLiveCountsLocations,
} from "./metric-catalog-estate.integration.spec";
import { priorOpenAlarmsInScope } from "./metric-catalog-prior";
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
 *
 * The prior (task 2.2): C1 at L2 holds one alarm raised 25 h ago and cleared 1 h ago — open at
 * the prior instant, closed now. C2 at L2 holds one non-critical alarm at a fixed instant `T`,
 * cleared at `T + 1 h`, for the edge cases. K at L1 sits on a template carrying `kw` (measured,
 * so its bound is 15 min): `kw` 7 at 24 h 5 min ago — inside the bound at the prior instant —
 * and 11 now. P adds a `site_kw` 120 / `it_kw` 100 pair a minute before the prior instant.
 * None of these moves a 2.1 number: C1, C2 and K are outside those cases' scopes.
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
  let tenantDb: BmsDb;
  let service: MetricCatalogService;
  let templateId = "";

  let orgId = "";
  const locationIds: string[] = [];
  const assetIds: string[] = [];
  const dashboardIds: string[] = [];
  let assetA1 = "";
  let assetA2 = "";
  let assetB1 = "";
  let assetP = "";
  let assetC1 = "";
  let assetC2 = "";
  let assetK = "";
  /** C2's alarm: raised at `edgeAt`, cleared an hour later. Millisecond-exact, from JS. */
  const edgeAt = new Date(Date.now() - 30 * 3_600_000);

  const tiles: Record<"sites" | "pue" | "alarms", { dashboardId: string; widgetId: string }> = {
    sites: { dashboardId: "", widgetId: "" },
    pue: { dashboardId: "", widgetId: "" },
    alarms: { dashboardId: "", widgetId: "" },
  };
  /** Task 2.2 — dashboards with two tiles on one binding: one asks for the prior, one does not. */
  const pairs: Record<"alarms" | "kw" | "pue", { dashboardId: string; asking: string; plain: string }> = {
    alarms: { dashboardId: "", asking: "", plain: "" },
    kw: { dashboardId: "", asking: "", plain: "" },
    pue: { dashboardId: "", asking: "", plain: "" },
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
    tenantDb = createDb(tenantPool);
    // `accessControl` is never reached: this suite drives `resolveForDashboard`.
    service = new MetricCatalogService(
      tenantDb,
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

    const template = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status, published_at)
       VALUES ($1, $2, 'F4.317 kw template', 'meter', $3, 'published', now()) RETURNING id`,
      [orgId, `f4317-kw-${RUN}`, domainCode],
    );
    templateId = template.rows[0]?.id ?? "";
    await superuserPool.query(
      `INSERT INTO bms.template_points (organization_id, template_id, point_key, kind, required)
       VALUES ($1, $2, 'kw', 'measured', false)`,
      [orgId, templateId],
    );

    const mkAsset = async (locationId: string, tag: string, onTemplate = false): Promise<string> => {
      const row = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, template_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        // Each asset its own `site_name`: a resolver counting site names would read three sites.
        [
          orgId,
          locationId,
          `F4317-${tag}-${RUN}`,
          `F4.317 ${tag} ${RUN}`,
          `F4.317 ${tag}`,
          domainCode,
          onTemplate ? templateId : null,
        ],
      );
      const id = row.rows[0]?.id ?? "";
      assetIds.push(id);
      return id;
    };
    assetA1 = await mkAsset(l1, "A1");
    assetA2 = await mkAsset(l1, "A2");
    assetB1 = await mkAsset(l2, "B1");
    assetP = await mkAsset(l1, "P");
    assetC1 = await mkAsset(l2, "C1");
    assetC2 = await mkAsset(l2, "C2");
    assetK = await mkAsset(l1, "K", true);

    // A minute before the prior instant: inside `latestPueRatio`'s 900 s window there.
    const beforePrior = `now() - interval '24 hours' - interval '1 minute'`;
    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
       VALUES (now(), $1, 'site_kw', 150), (now(), $1, 'it_kw', 100),
              (${beforePrior}, $1, 'site_kw', 120), (${beforePrior}, $1, 'it_kw', 100)`,
      [assetP],
    );
    // K: 7 five minutes before the prior instant (inside the 15 min measured bound), 11 now.
    await superuserPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
       VALUES (now() - interval '24 hours' - interval '5 minutes', $1, 'kw', 7), (now(), $1, 'kw', 11)`,
      [assetK],
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
    // C1: open at the prior instant, cleared since.
    await superuserPool.query(
      `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
       VALUES ($1, $2, $3, $4, now() - interval '25 hours', now() - interval '1 hour')`,
      [orgId, assetC1, criticalCode, `F4.317 prior ${RUN}`],
    );
    // C2: the edge alarm, non-critical, raised at exactly `edgeAt`.
    await superuserPool.query(
      `INSERT INTO bms.alarms (organization_id, asset_id, severity, message, raised_at, cleared_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '1 hour')`,
      [orgId, assetC2, otherCode, `F4.317 edge ${RUN}`, edgeAt.toISOString()],
    );

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

    /** An organization-wide dashboard with two `value_tile`s on one binding; one asks. */
    const mkPair = async (tag: string, catalogKey: string, params: object) => {
      const dash = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, `f4317-prior-${tag}-${RUN}`, `F4.317 prior ${tag} ${RUN}`],
      );
      const dashboardId = dash.rows[0]?.id ?? "";
      dashboardIds.push(dashboardId);
      const mkWidget = async (config: object): Promise<string> => {
        const widget = await superuserPool.query<{ id: string }>(
          `INSERT INTO bms.dashboard_widgets
             (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
           VALUES ($1, $2, 'value_tile', 0, 0, 3, 2, $3::jsonb) RETURNING id`,
          [orgId, dashboardId, JSON.stringify(config)],
        );
        const widgetId = widget.rows[0]?.id ?? "";
        await superuserPool.query(
          `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [orgId, widgetId, catalogKey, JSON.stringify(params)],
        );
        return widgetId;
      };
      const asking = await mkWidget({ compareToPrevious: true });
      const plain = await mkWidget({});
      return { dashboardId, asking, plain };
    };
    pairs.alarms = await mkPair("alarms", "alarms.active.count", {});
    pairs.kw = await mkPair("kw", "sustainability.total", { pointKey: "kw", aggregate: "sum" });
    pairs.pue = await mkPair("pue", "pue.ratio", {});
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
    if (templateId) {
      await superuserPool.query(`DELETE FROM bms.asset_templates WHERE id = $1`, [templateId]);
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

  it("an alarm raised 25 h ago and cleared 1 h ago is 0 live and 1 at the prior instant", async () => {
    await assertPriorOnlyWhenAsked(
      service,
      orgId,
      pairs.alarms.dashboardId,
      [assetC1],
      pairs.alarms.asking,
      pairs.alarms.plain,
      "alarms.active.count",
      { live: 0, prior: 1 },
    );
  });

  it("sustainability.total {kw, sum}: 11 now, 7 at the prior instant (its own 15 min bound)", async () => {
    await assertPriorOnlyWhenAsked(
      service,
      orgId,
      pairs.kw.dashboardId,
      [assetK],
      pairs.kw.asking,
      pairs.kw.plain,
      "sustainability.total",
      { live: 11, prior: 7 },
    );
  });

  it("pue.ratio: 1.5 now, 1.2 at the prior instant", async () => {
    await assertPriorOnlyWhenAsked(
      service,
      orgId,
      pairs.pue.dashboardId,
      [assetP],
      pairs.pue.asking,
      pairs.pue.plain,
      "pue.ratio",
      { live: 1.5, prior: 1.2 },
    );
  });

  it("an alarm raised at exactly the prior instant counts, and one cleared at it does not", async () => {
    await assertPriorOpenAlarmsEdges(
      (at, criticalOnly) =>
        withTenant(tenantDb, orgId, (tx) => priorOpenAlarmsInScope(tx, orgId, [assetC2], at, criticalOnly)),
      edgeAt,
    );
  });
});
