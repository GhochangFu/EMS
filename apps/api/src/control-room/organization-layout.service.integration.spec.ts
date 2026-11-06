import { expect } from "vitest";

import { ORGANIZATION_HAS_LAYOUT_MESSAGE, type OrganizationControlRoomViewDto } from "@bms/shared";
import { ORGANIZATION_STANDARD_TEMPLATE } from "@bms/shared/site-templates";

import { AssetHealthService } from "../asset-health/asset-health.service";
import { OrganizationViewAccessService } from "../auth/organization-view-access.service";
import { MetricCatalogService } from "../dashboard-builder/metric-catalog.service";
import {
  clearOrganizationView,
  newOrganizationWideDashboard,
  pointOrganizationAt,
  reportNow,
  type OrganizationLayoutFixture,
} from "../testing/organization-layout-harness";
import { OrganizationLayoutService, organizationTemplateArmOf } from "./organization-layout.service";

/**
 * `F4.317` task 4.2 (ADR 0112 decisions 3, 4 and 5) — `OrganizationLayoutService` under real RLS:
 * the read and its fail-safe, "Make organization layout", "Reset to default", and who may do
 * them. Assertions only; `organization-layout.service.integration.test.ts` owns the harness
 * (ADR 0014). Every case that writes A's view row leaves it removed.
 */

export function serviceOf(fx: OrganizationLayoutFixture): OrganizationLayoutService {
  return new OrganizationLayoutService(
    fx.fleetDb,
    fx.tenantDb,
    fx.accessControl,
    new OrganizationViewAccessService(fx.fleetDb, fx.accessControl),
    fx.audit,
    new MetricCatalogService(fx.tenantDb, fx.fleetDb, fx.accessControl, new AssetHealthService(fx.fleetDb), fx.fleetPool),
  );
}

async function statusOf(promise: Promise<unknown>): Promise<{ status: number | null; message: string }> {
  try {
    await promise;
    return { status: null, message: "" };
  } catch (err) {
    const e = err as { getStatus?: () => number; message?: string };
    return { status: e.getStatus?.() ?? -1, message: e.message ?? String(err) };
  }
}

function sitesTile(view: OrganizationControlRoomViewDto) {
  const tile = view.tiles.find((t) => t.sources.some((s) => s.catalogKey === "sites.live.count"));
  const resolved = tile?.sources[0]?.resolved;
  return resolved?.shape === "metric" ? { value: resolved.value, coverage: resolved.coverage } : null;
}

async function viewRow(fx: OrganizationLayoutFixture, org: string): Promise<{ dashboard_id: string | null } | undefined> {
  const { rows } = await fx.superuserPool.query<{ dashboard_id: string | null }>(
    `SELECT dashboard_id FROM bms.organization_control_room_views WHERE organization_id = $1`,
    [org],
  );
  return rows[0];
}

/** No row: the stock strip, fourteen tiles in decision 6's order, every source resolved. */
export async function assertNoRowReadsTheStockStrip(fx: OrganizationLayoutFixture): Promise<void> {
  await clearOrganizationView(fx, fx.orgA);
  const view = await serviceOf(fx).view(fx.jwt.admin, fx.orgA);
  expect(view.kind).toBe("stock");
  expect(view.dashboardId).toBeNull();
  expect(view.layoutName).toBe(ORGANIZATION_STANDARD_TEMPLATE.name);
  expect(view.tiles.map((t) => t.key)).toEqual(ORGANIZATION_STANDARD_TEMPLATE.content.widgets.map((w) => w.key));
  expect(view.tiles).toHaveLength(14);
  expect(view.tiles.every((t) => t.sources.every((s) => s.resolved !== null))).toBe(true);
  // Tile 3 carries both keys, the primary first (ruling Q1b).
  expect(view.tiles[2]?.sources.map((s) => s.catalogKey)).toEqual(["alarms.active.count", "alarms.critical.count"]);
  // A tile with `compareToPrevious` asks for the prior (ruling Q5); one without does not.
  const openAlarms = view.tiles[2]?.sources[0]?.resolved;
  expect(openAlarms?.shape === "metric" && openAlarms.prior !== undefined).toBe(true);
  const pue = view.tiles[3]?.sources[0]?.resolved;
  expect(pue?.shape === "metric" && pue.prior === undefined).toBe(true);
  expect(view.canManage).toBe(true);
}

/** Tile 2 is live / total locations: A has two, one reporting. */
export async function assertSitesTileCountsTheOrganizationsLocations(fx: OrganizationLayoutFixture): Promise<void> {
  await reportNow(fx, fx.assetA1);
  const view = await serviceOf(fx).view(fx.jwt.admin, fx.orgA);
  expect(sitesTile(view)).toEqual({ value: 1, coverage: { fresh: 1, carrying: 2 } });
}

/** A location admin of A1 reads the strip over its own assets only: one location, live. */
export async function assertValuesAreOverTheReadersAssetsOnly(fx: OrganizationLayoutFixture): Promise<void> {
  await reportNow(fx, fx.assetA1);
  const svc = serviceOf(fx);
  const own = await svc.view(fx.jwt.locAdminA, fx.orgA);
  expect(sitesTile(own)).toEqual({ value: 1, coverage: { fresh: 1, carrying: 1 } });
  expect(own.canManage).toBe(true);
  const group = await svc.view(fx.jwt.groupAdminA, fx.orgA);
  expect(sitesTile(group)).toEqual({ value: 1, coverage: { fresh: 1, carrying: 1 } });
  expect(group.canManage).toBe(false);
}

/** An organization the caller cannot read is a 404, and so is one that does not exist. */
export async function assertUnreadableIsNotFound(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  expect((await statusOf(svc.view(fx.jwt.locAdminB, fx.orgA))).status).toBe(404);
  expect((await statusOf(svc.view(fx.jwt.admin, "00000000-0000-4000-8000-0000000000aa"))).status).toBe(404);
}

/**
 * Make: one organization-wide copy stamped with the template, its fourteen tiles and their
 * sources, the row pointing at it, an audit row — and the read now answers the copy.
 */
export async function assertMakeCopiesAndPoints(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  try {
    const made = await svc.make(fx.jwt.locAdminA, fx.orgA, {});
    expect(made.organizationId).toBe(fx.orgA);
    expect(made.templateId).toBe(fx.templateA);
    expect((await viewRow(fx, fx.orgA))?.dashboard_id).toBe(made.dashboardId);

    const { rows: dash } = await fx.superuserPool.query(
      `SELECT organization_id, location_id, asset_group_id, asset_id, template_id, slug FROM bms.dashboards WHERE id = $1`,
      [made.dashboardId],
    );
    expect(dash[0]).toEqual({
      organization_id: fx.orgA,
      location_id: null,
      asset_group_id: null,
      asset_id: null,
      template_id: fx.templateA,
      slug: made.dashboardSlug,
    });
    const { rows: counts } = await fx.superuserPool.query<{ widgets: number; sources: number }>(
      `SELECT (SELECT count(*)::int FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND organization_id = $2) AS widgets,
              (SELECT count(*)::int FROM bms.dashboard_widget_sources s JOIN bms.dashboard_widgets w ON w.id = s.widget_id
                WHERE w.dashboard_id = $1 AND s.organization_id = $2) AS sources`,
      [made.dashboardId, fx.orgA],
    );
    expect(counts[0]).toEqual({ widgets: 14, sources: 15 });
    const { rows: audits } = await fx.superuserPool.query(
      `SELECT 1 FROM bms.audit_log WHERE organization_id = $1 AND action = 'master.organization.control_room_view.make'
         AND entity_id = $1 AND payload->>'dashboardId' = $2`,
      [fx.orgA, made.dashboardId],
    );
    expect(audits).toHaveLength(1);

    const view = await svc.view(fx.jwt.admin, fx.orgA);
    expect(view.kind).toBe("dashboard");
    expect(view.dashboardId).toBe(made.dashboardId);
    expect(view.dashboardSlug).toBe(made.dashboardSlug);
    expect(view.tiles).toHaveLength(14);
    expect(view.tiles[2]?.sources.map((s) => s.catalogKey)).toEqual(["alarms.active.count", "alarms.critical.count"]);
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}

/** Ruling Q2 — Make over a live layout is a 409 "Reset to default first", and writes nothing. */
export async function assertMakeOverALiveLayoutIsRefused(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  try {
    const copies = async (): Promise<number> => {
      const { rows } = await fx.superuserPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bms.dashboards WHERE organization_id = $1`,
        [fx.orgA],
      );
      return rows[0]?.n ?? -1;
    };
    const made = await svc.make(fx.jwt.admin, fx.orgA, {});
    const before = await copies();
    const again = await statusOf(svc.make(fx.jwt.admin, fx.orgA, {}));
    expect(again).toEqual({ status: 409, message: ORGANIZATION_HAS_LAYOUT_MESSAGE });
    expect((await viewRow(fx, fx.orgA))?.dashboard_id).toBe(made.dashboardId);
    expect(await copies()).toBe(before);
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}

/** A row whose copy was deleted (`dashboard_id` NULL) is re-made in place. */
export async function assertARemovedCopyIsRemadeInPlace(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  try {
    await pointOrganizationAt(fx, fx.orgA, null);
    const made = await svc.make(fx.jwt.admin, fx.orgA, { templateId: fx.templateA });
    expect((await viewRow(fx, fx.orgA))?.dashboard_id).toBe(made.dashboardId);
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}

/** Reset: the row goes, the copy stays, an audit row says so, and the read is the stock strip. */
export async function assertResetDropsTheRowAndKeepsTheCopy(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  const made = await svc.make(fx.jwt.orgAdminA, fx.orgA, {});
  await svc.reset(fx.jwt.locAdminA, fx.orgA);
  expect(await viewRow(fx, fx.orgA)).toBeUndefined();
  const { rows } = await fx.superuserPool.query(`SELECT 1 FROM bms.dashboards WHERE id = $1`, [made.dashboardId]);
  expect(rows).toHaveLength(1);
  const { rows: audits } = await fx.superuserPool.query(
    `SELECT 1 FROM bms.audit_log WHERE organization_id = $1 AND action = 'master.organization.control_room_view.reset'
       AND payload->>'dashboardId' = $2`,
    [fx.orgA, made.dashboardId],
  );
  expect(audits).toHaveLength(1);
  expect((await svc.view(fx.jwt.admin, fx.orgA)).kind).toBe("stock");
  // Idempotent: a second reset with no row answers without writing.
  await svc.reset(fx.jwt.admin, fx.orgA);
}

/** Who may change the strip: a location admin of A on A yes, on B no; an asset-group admin no. */
export async function assertWhoMayChangeTheStrip(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  expect((await statusOf(svc.make(fx.jwt.locAdminA, fx.orgB, {}))).status).toBe(403);
  expect((await statusOf(svc.reset(fx.jwt.locAdminA, fx.orgB))).status).toBe(403);
  expect((await statusOf(svc.make(fx.jwt.groupAdminA, fx.orgA, {}))).status).toBe(403);
  expect((await statusOf(svc.reset(fx.jwt.groupAdminA, fx.orgA))).status).toBe(403);
  expect(await viewRow(fx, fx.orgA)).toBeUndefined();
  expect(await viewRow(fx, fx.orgB)).toBeUndefined();
}

/** Another organization's template id reads as not found: the copy reads under this organization. */
export async function assertAForeignTemplateIsNotFound(fx: OrganizationLayoutFixture): Promise<void> {
  const result = await statusOf(serviceOf(fx).make(fx.jwt.admin, fx.orgA, { templateId: fx.templateB }));
  expect(result.status).toBe(404);
  expect(await viewRow(fx, fx.orgA)).toBeUndefined();
}

/**
 * The fail-safe ignores a row whose dashboard is not this organization's organization-wide one:
 * a row pointed (by a superuser, past the policy) at B's dashboard, and a row pointed at a copy
 * someone re-scoped to a site, both read as the stock strip.
 */
export async function assertAForeignOrScopedRowIsIgnored(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  const foreign = await newOrganizationWideDashboard(fx, fx.orgB, "foreign");
  const scoped = await newOrganizationWideDashboard(fx, fx.orgA, "scoped");
  await fx.superuserPool.query(`UPDATE bms.dashboards SET location_id = $2 WHERE id = $1`, [scoped, fx.locA1]);
  try {
    await pointOrganizationAt(fx, fx.orgA, foreign);
    expect((await svc.view(fx.jwt.admin, fx.orgA)).kind).toBe("stock");
    await pointOrganizationAt(fx, fx.orgA, scoped);
    expect((await svc.view(fx.jwt.admin, fx.orgA)).kind).toBe("stock");
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}

/**
 * A row the read ignores is not a live layout, so Make and Reset agree with the view. A row
 * pointed past the policy at B's dashboard is invisible under A's GUC: Reset still removes it (and
 * audits), and Make still makes. A row pointed at A's own copy that someone re-scoped to a site is
 * re-pointed in place, and the re-scoped copy is left alone.
 */
export async function assertAnIgnoredRowIsNotALiveLayout(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  const foreign = await newOrganizationWideDashboard(fx, fx.orgB, "ignored-foreign");
  const scoped = await newOrganizationWideDashboard(fx, fx.orgA, "ignored-scoped");
  await fx.superuserPool.query(`UPDATE bms.dashboards SET location_id = $2 WHERE id = $1`, [scoped, fx.locA1]);
  try {
    await pointOrganizationAt(fx, fx.orgA, foreign);
    await svc.reset(fx.jwt.admin, fx.orgA);
    expect(await viewRow(fx, fx.orgA)).toBeUndefined();
    const { rows: audits } = await fx.superuserPool.query(
      `SELECT 1 FROM bms.audit_log WHERE organization_id = $1 AND action = 'master.organization.control_room_view.reset'
         AND payload->>'dashboardId' = $2`,
      [fx.orgA, foreign],
    );
    expect(audits).toHaveLength(1);

    await pointOrganizationAt(fx, fx.orgA, foreign);
    const overForeign = await svc.make(fx.jwt.admin, fx.orgA, {});
    expect((await viewRow(fx, fx.orgA))?.dashboard_id).toBe(overForeign.dashboardId);
    expect((await svc.view(fx.jwt.admin, fx.orgA)).kind).toBe("dashboard");

    await pointOrganizationAt(fx, fx.orgA, scoped);
    expect((await svc.view(fx.jwt.admin, fx.orgA)).kind).toBe("stock");
    const overScoped = await svc.make(fx.jwt.locAdminA, fx.orgA, {});
    expect((await viewRow(fx, fx.orgA))?.dashboard_id).toBe(overScoped.dashboardId);
    expect((await svc.view(fx.jwt.admin, fx.orgA)).kind).toBe("dashboard");
    const { rows } = await fx.superuserPool.query(`SELECT location_id FROM bms.dashboards WHERE id = $1`, [scoped]);
    expect(rows[0]).toEqual({ location_id: fx.locA1 });
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}

/**
 * The strip reads the copy's flat list only: a value tile someone put on a tab of the copy (the
 * organization target refuses tabs, ADR 0112 decision 2) is not merged into the strip.
 */
export async function assertATabbedTileIsNotDrawn(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  try {
    const made = await svc.make(fx.jwt.admin, fx.orgA, {});
    const { rows: tab } = await fx.superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_tabs (organization_id, dashboard_id, tab_key, label) VALUES ($1, $2, 'more', 'More') RETURNING id`,
      [fx.orgA, made.dashboardId],
    );
    await fx.superuserPool.query(
      `INSERT INTO bms.dashboard_widgets (organization_id, dashboard_id, tab_id, widget_type, title, grid_x, grid_y, grid_w, grid_h)
       VALUES ($1, $2, $3, 'value_tile', 'On a tab', 0, 0, 3, 2)`,
      [fx.orgA, made.dashboardId, tab[0]?.id],
    );
    const view = await svc.view(fx.jwt.admin, fx.orgA);
    expect(view.kind).toBe("dashboard");
    expect(view.tiles).toHaveLength(14);
    expect(view.tiles.some((t) => t.title === "On a tab")).toBe(false);
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}

/** The `instantiate` organization arm `AdminModule` provides drives the same copy. */
export async function assertTheArmMakesTheLayout(fx: OrganizationLayoutFixture): Promise<void> {
  const arm = organizationTemplateArmOf(serviceOf(fx));
  try {
    const made = (await arm(fx.jwt.admin, { id: fx.templateA, organizationId: fx.orgA }, { organizationId: fx.orgA })) as {
      dashboardId: string;
      templateId: string;
    };
    expect(made.templateId).toBe(fx.templateA);
    expect((await viewRow(fx, fx.orgA))?.dashboard_id).toBe(made.dashboardId);
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}
