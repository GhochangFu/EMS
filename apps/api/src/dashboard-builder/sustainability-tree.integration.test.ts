import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import { LOCATION_TREE_MAX_DEPTH } from "@bms/shared";

import { AssetHealthService } from "../asset-health/asset-health.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { MetricCatalogService } from "./metric-catalog.service";
import {
  aCampusDashboardTotalSumsTheSubtree,
  aReaderGrantedSiteAGroupsByItselfAtDepthOne,
  anOutOfRangeGroupDepthBindingIsSkippedNotThrown,
  assetsListOnTheSameDashboardStaysPerNode,
  byLocationAtDepthOneIsOneCampusRowWhoseValueEqualsTheTotal,
  byLocationAtDepthTwoKeepsTheCampusAssetOnItsOwnRow,
  byLocationWithoutGroupDepthListsThreeNodes,
  type TreeFixture,
} from "./sustainability-tree.integration.spec";

/**
 * `F2.10` U2 — Vitest entry point for the sustainability entries over a location tree.
 * Assertions live in the sibling `.integration.spec.ts` (ADR 0014); this file owns the
 * database lifecycle and the fixture.
 *
 * **The fixture lives in an organization this suite creates** (`F210S-<run>`), committed as
 * `bms_fleet` in `beforeAll` and deleted — rows first, the organization last — in `afterAll`
 * (the `report-files.integration.spec.ts` `capOrganizationId` precedent). Never a seeded
 * organization: the tree guard's advisory lock is per organization, and the organization's own
 * assets are then the only ones any read can see, so every number is the fixture's.
 *
 * The template / sample / dashboard insert shape is `sustainability-rollup.integration.test.ts`'s.
 * The telemetry DELETE is bounded by time as well as `asset_id` (a hypertable) for the reason
 * that file gives.
 */
const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "the sustainability entries over a location tree (subtree scope, groupDepth)",
  because:
    "whether a campus dashboard's total sums its sites, whether a grouped row is labelled with an " +
    "ancestor the reader cannot read, and whether the grouped rows sum to the total are facts about " +
    "a real recursive walk under a real tenant transaction.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F2.10 U2 — sustainability over a location tree", () => {
  let fleetPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fixture: TreeFixture;

  let orgId = "";
  let templateId = "";
  const locationIds: string[] = [];
  const assetIds: string[] = [];
  let dashboardId = "";

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F2.10 U2", {
      max: 1,
    });
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.10 U2",
      { max: 1 },
    );
    const fleetDb = createDb(fleetPool);
    const service = new MetricCatalogService(
      createDb(tenantPool),
      fleetDb,
      undefined as unknown as ConstructorParameters<typeof MetricCatalogService>[2],
      new AssetHealthService(fleetDb),
    );

    const org = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
      [`F210S-${RUN}`, `F2.10 sustainability tree ${RUN}`],
    );
    orgId = org.rows[0]?.id ?? "";
    if (!orgId) throw new Error("F2.10 U2: the fixture organization was not created");

    const domain = await fleetPool.query<{ code: string }>(`SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`);
    const domainCode = domain.rows[0]?.code ?? "";

    const mkLocation = async (tag: string, parentId: string | null) => {
      const code = `F210S-${RUN}-${tag}`;
      const name = `F2.10 ${tag} ${RUN}`;
      const row = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
         VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, $5) RETURNING id`,
        [orgId, code, code.toLowerCase(), name, parentId],
      );
      const id = row.rows[0]?.id ?? "";
      locationIds.push(id);
      return { id, code, name };
    };
    const campus = await mkLocation("CAMPUS", null);
    const siteA = await mkLocation("SITEA", campus.id);
    const siteB = await mkLocation("SITEB", campus.id);

    const template = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status, published_at)
       VALUES ($1, $2, 'F2.10 U2 template', 'meter', $3, 'published', now()) RETURNING id`,
      [orgId, `f210s-${RUN}`, domainCode],
    );
    templateId = template.rows[0]?.id ?? "";
    await fleetPool.query(
      `INSERT INTO bms.template_points (organization_id, template_id, point_key, kind, required)
       VALUES ($1, $2, 'kwh_today', 'measured', false)`,
      [orgId, templateId],
    );

    const mkAsset = async (locationId: string, tag: string): Promise<string> => {
      const row = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, template_id)
         VALUES ($1, $2, $3, $4, 'F2.10', $5, $6) RETURNING id`,
        [orgId, locationId, `F210S-${RUN}-${tag}`, `F2.10 ${tag} ${RUN}`, domainCode, templateId],
      );
      const id = row.rows[0]?.id ?? "";
      assetIds.push(id);
      return id;
    };
    const campusAsset = await mkAsset(campus.id, "C");
    const siteAAsset = await mkAsset(siteA.id, "SA");
    const siteBAsset = await mkAsset(siteB.id, "SB");

    await fleetPool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES
         (now(), $1, 'kwh_today', 1),
         (now(), $2, 'kwh_today', 10),
         (now(), $3, 'kwh_today', 100)`,
      [campusAsset, siteAAsset, siteBAsset],
    );

    const dash = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.dashboards (organization_id, slug, name, location_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [orgId, `f210s-${RUN}`, `F2.10 U2 campus ${RUN}`, campus.id],
    );
    dashboardId = dash.rows[0]?.id ?? "";
    const bind = async (index: number, widgetType: string, catalogKey: string, params: unknown): Promise<string> => {
      const widget = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_widgets (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h)
         VALUES ($1, $2, $3, 0, $4, 3, 2) RETURNING id`,
        [orgId, dashboardId, widgetType, index * 2],
      );
      const source = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_widget_sources (organization_id, widget_id, catalog_key, params)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, widget.rows[0]?.id, catalogKey, JSON.stringify(params)],
      );
      return source.rows[0]?.id ?? "";
    };
    const sum = { pointKey: "kwh_today", aggregate: "sum" };
    const totalSourceId = await bind(0, "value_tile", "sustainability.total", sum);
    const byNodeSourceId = await bind(1, "table", "sustainability.by_location", sum);
    const depthOneSourceId = await bind(2, "table", "sustainability.by_location", { ...sum, groupDepth: 1 });
    const depthTwoSourceId = await bind(3, "table", "sustainability.by_location", { ...sum, groupDepth: 2 });
    const assetsListSourceId = await bind(4, "table", "assets.list", {});
    // Past the write schema, as a hand-edited row would be: the read path must skip them.
    const tooDeepSourceId = await bind(5, "table", "sustainability.by_location", {
      ...sum,
      groupDepth: LOCATION_TREE_MAX_DEPTH + 1,
    });
    const zeroDepthSourceId = await bind(6, "table", "sustainability.by_location", { ...sum, groupDepth: 0 });

    fixture = {
      service,
      orgId,
      campusId: campus.id,
      siteAId: siteA.id,
      campusCode: campus.code,
      siteACode: siteA.code,
      siteBCode: siteB.code,
      campusName: campus.name,
      siteAName: siteA.name,
      siteAAssetId: siteAAsset,
      dashboardId,
      totalSourceId,
      byNodeSourceId,
      depthOneSourceId,
      depthTwoSourceId,
      assetsListSourceId,
      tooDeepSourceId,
      zeroDepthSourceId,
    };
  }, 60_000);

  afterAll(async () => {
    // Guarded on truthiness: `beforeAll` can fail partway.
    try {
      if (dashboardId) await fleetPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [dashboardId]);
      const assets = assetIds.filter(Boolean);
      if (assets.length > 0) {
        await fleetPool.query(
          `DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[]) AND time > now() - interval '1 hour'`,
          [assets],
        );
        await fleetPool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])`, [assets]);
        await fleetPool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [assets]);
      }
      if (templateId) await fleetPool.query(`DELETE FROM bms.asset_templates WHERE id = $1`, [templateId]);
      // Leaf-first (ADR 0098 decision 5): the sites, then the campus.
      for (const id of [...locationIds].reverse().filter(Boolean)) {
        await fleetPool.query(`DELETE FROM bms.locations WHERE id = $1`, [id]);
      }
      if (orgId) {
        const removed = await fleetPool.query(`DELETE FROM bms.organizations WHERE id = $1`, [orgId]);
        if (removed.rowCount !== 1) throw new Error(`F2.10 U2: expected to delete the fixture organization, deleted ${removed.rowCount}`);
      }
    } finally {
      await Promise.all([fleetPool, tenantPool].filter(Boolean).map((p) => p.end()));
    }
  }, 60_000);

  it("a campus dashboard's sustainability.total sums the whole subtree (B1)", async () => {
    await aCampusDashboardTotalSumsTheSubtree(fixture);
  });

  it("assets.list on the same dashboard stays per node (the B1 negative)", async () => {
    await assetsListOnTheSameDashboardStaysPerNode(fixture);
  });

  it("by_location without groupDepth lists the subtree's three nodes", async () => {
    await byLocationWithoutGroupDepthListsThreeNodes(fixture);
  });

  it("by_location at depth 1 is one campus row whose value equals the total (B2)", async () => {
    await byLocationAtDepthOneIsOneCampusRowWhoseValueEqualsTheTotal(fixture);
  });

  it("by_location at depth 2 keeps the campus asset on its own row (B2)", async () => {
    await byLocationAtDepthTwoKeepsTheCampusAssetOnItsOwnRow(fixture);
  });

  it("a reader granted siteA alone groups by siteA at depth 1, never the unreadable campus (A6)", async () => {
    await aReaderGrantedSiteAGroupsByItselfAtDepthOne(fixture);
  });

  it("an out-of-range groupDepth binding is skipped, not thrown (C)", async () => {
    await anOutOfRangeGroupDepthBindingIsSkippedNotThrown(fixture);
  });
});
