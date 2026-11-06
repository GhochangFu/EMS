import type pg from "pg";

import { PUMP_STATION_STANDARD_SITE_TEMPLATE, SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import type { PheCatalogFile } from "./phe-pilot-seed";
import {
  ensureSiteTemplate,
  pheSiteLayoutStations,
  type PlannedCopyTab,
  planSiteCopy,
  resolvePhewbSiteLayoutLocations,
  type SeededSiteTemplate,
  seedSiteLayouts,
  SITE_LAYOUT_PHEWB_CHOICE,
  SITE_LAYOUT_PHEWB_PUMP_STATION_CHOICE,
  SITE_LAYOUT_SLUG_PREFIX,
  type SiteLayoutSeedOutcome,
  siteLayoutSlug,
  writeSiteLayoutTabs,
} from "./site-layout-seed";
import { activePointsByAsset } from "./site-layout-seed-reads";
import { SITE_LAYOUT_COPY_DESCRIPTION, upgradeSeededSiteLayoutCopies } from "./site-layout-seed-upgrade";
import { canonicalJson } from "./site-layout-stock-history";

/**
 * `F4.319` (ADR 0113 decision 8, plan D5–D7) — the seed moves the untouched PHEWB site-layout
 * copies from `smoc-standard` to `pump-station-standard`.
 *
 * **Which copy moves.** A PHEWB seed-owned location whose `bms.site_control_room_views` row is
 * `kind = 'dashboard'` and points at the copy with slug `site-layout-<slug>`, stamped with a
 * `smoc-standard` template at the current smoc stock version, named and described as the seed
 * names and describes it, whose tabs and widgets are exactly the copy the seed would make at that
 * site now. Anything else is left alone: a copy an administrator edited, a removed copy (a view
 * row with no dashboard), a `builtin` or `generated` row, a copy at an older stock shape.
 *
 * **Why content and not the stamp** (plan §2 F5). `bms.dashboards.stock_version` is written by
 * the seed only, so an administrator who moves a widget leaves it unchanged. The stored copy is
 * compared with a fresh plan of `smoc-standard` at the same site ({@link copyFingerprint}), the
 * same planner and tile rule the seed makes a copy with. No hash is stored, so no schema changes.
 *
 * **How it moves: in place** (plan D6). The copy's tabs and widgets are deleted (points and
 * sources go by `ON DELETE CASCADE`), the `pump-station-standard` plan is written by the writer a
 * fresh copy uses, and the dashboard's `template_id`, `stock_version` and `description` are set
 * with the read values in the predicate, under a row lock taken at the read. The view row, the dashboard id, its slug and its name
 * stay. Once moved, the copy's template code is `pump-station-standard`, so neither the smoc
 * upgrade chain nor this step reads it again: a second run writes nothing.
 *
 * Runs in the caller's `withOrganization` bracket, like every site-layout seed write, and checks
 * each row count: a FORCE-RLS write can drop a row without raising.
 */

/** The copy's description once it holds `pump-station-standard`. */
export const PUMP_STATION_COPY_DESCRIPTION =
  "Pump station standard site layout: an Overview of the water path, an electrical tab and an RTU-health tab.";

/** One widget of a copy, as the fingerprint reads it. */
export type CopyFingerprintWidget = {
  readonly tabKey: string;
  readonly widgetType: string;
  readonly title: string | null;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly config: unknown;
  readonly points: readonly { readonly pointId: string; readonly role: string; readonly sortOrder: number }[];
  readonly sources: readonly { readonly catalogKey: string; readonly params: unknown; readonly sortOrder: number }[];
};

export type CopyFingerprintTab = {
  readonly tabKey: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly assetGroupId: string | null;
};

/**
 * One string for a copy's tabs and widgets, order-free: two copies with the same fingerprint hold
 * the same tabs (key, label, order, group) and the same widgets (tab, type, title, rect, config,
 * points with their role and order, sources with their params and order). Pure, so the rule is
 * held by a unit spec (`site-layout-seed-move.spec.ts`).
 */
export function copyFingerprint(tabs: readonly CopyFingerprintTab[], widgets: readonly CopyFingerprintWidget[]): string {
  const tabRows = tabs.map((tab) => canonicalJson(tab)).sort();
  const widgetRows = widgets
    .map((widget) =>
      canonicalJson({
        ...widget,
        points: widget.points.map((point) => canonicalJson(point)).sort(),
        sources: widget.sources.map((source) => canonicalJson(source)).sort(),
      }),
    )
    .sort();
  return canonicalJson({ tabs: tabRows, widgets: widgetRows });
}

/** The fingerprint of a planned copy, the shape {@link writeSiteLayoutTabs} would store. */
export function plannedCopyFingerprint(tabs: readonly PlannedCopyTab[]): string {
  return copyFingerprint(
    tabs.map(({ row }) => ({
      tabKey: row.tab.key,
      label: row.tab.label,
      sortOrder: row.tab.sortOrder,
      assetGroupId: row.group?.id ?? null,
    })),
    tabs.flatMap(({ row, widgets }) =>
      widgets.map((plan) => ({
        tabKey: row.tab.key,
        widgetType: plan.widget.widgetType,
        title: plan.widget.title,
        gridX: plan.widget.gridX,
        gridY: plan.widget.gridY,
        gridW: plan.widget.gridW,
        gridH: plan.widget.gridH,
        config: plan.widget.config,
        points: plan.points.map((point, index) => ({ pointId: point.pointId, role: plan.pointRole, sortOrder: index })),
        sources: plan.widget.sources.map((source, index) => ({
          catalogKey: source.catalogKey,
          params: source.params,
          sortOrder: source.sortOrder ?? index,
        })),
      })),
    ),
  );
}

/**
 * The candidate copy at a location: its view row points at it. Params: `[locationId,
 * organizationId, slug]`. `FOR UPDATE OF d` locks the dashboard row for the rest of the seed's
 * transaction: a builder save updates that row first (`DashboardsService.putWidgets`), so an
 * admin edit made while the seed compares and rewrites the copy waits, and is never deleted.
 */
const CANDIDATE_SQL = `
  SELECT d.id, d.name, d.description, d.stock_version, d.template_id, t.code AS template_code
    FROM bms.site_control_room_views v
    JOIN bms.dashboards d ON d.id = v.dashboard_id
    JOIN bms.dashboard_templates t ON t.id = d.template_id
   WHERE v.location_id = $1 AND v.kind = 'dashboard'
     AND d.organization_id = $2 AND d.location_id = $1 AND d.slug = $3
     FOR UPDATE OF d
`;
const LOCATION_SQL = `SELECT slug, name FROM bms.locations WHERE id = $1 AND organization_id = $2`;
const STORED_TABS_SQL = `
  SELECT tab_key, label, sort_order, asset_group_id FROM bms.dashboard_tabs
   WHERE dashboard_id = $1 AND organization_id = $2
`;
const STORED_WIDGETS_SQL = `
  SELECT w.id, COALESCE(t.tab_key, '') AS tab_key, w.widget_type, w.title,
         w.grid_x, w.grid_y, w.grid_w, w.grid_h, w.config
    FROM bms.dashboard_widgets w
    LEFT JOIN bms.dashboard_tabs t ON t.id = w.tab_id
   WHERE w.dashboard_id = $1 AND w.organization_id = $2
`;
const STORED_POINTS_SQL = `
  SELECT p.widget_id, p.point_id, p.role, p.sort_order
    FROM bms.dashboard_widget_points p
    JOIN bms.dashboard_widgets w ON w.id = p.widget_id
   WHERE w.dashboard_id = $1 AND w.organization_id = $2
`;
const STORED_SOURCES_SQL = `
  SELECT s.widget_id, s.catalog_key, s.params, s.sort_order
    FROM bms.dashboard_widget_sources s
    JOIN bms.dashboard_widgets w ON w.id = s.widget_id
   WHERE w.dashboard_id = $1 AND w.organization_id = $2
`;
const DELETE_WIDGETS_SQL = `DELETE FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND organization_id = $2`;
const DELETE_TABS_SQL = `DELETE FROM bms.dashboard_tabs WHERE dashboard_id = $1 AND organization_id = $2`;
/** The read values are in the predicate as well as the row lock CANDIDATE_SQL takes (belt and braces). */
const RESTAMP_SQL = `
  UPDATE bms.dashboards
     SET template_id = $3, stock_version = $4, description = $5, updated_at = now()
   WHERE id = $1 AND organization_id = $2
     AND template_id = $6 AND stock_version IS NOT DISTINCT FROM $7::int
`;
const READ_BACK_SQL = `
  SELECT (SELECT count(*)::int FROM bms.dashboard_tabs WHERE dashboard_id = $1) AS tabs,
         (SELECT count(*)::int FROM bms.dashboard_widgets WHERE dashboard_id = $1) AS widgets
`;

/** The stored fingerprint of the copy `dashboardId`. */
async function storedFingerprint(pool: Pick<pg.Pool, "query">, organizationId: string, dashboardId: string): Promise<string> {
  const params = [dashboardId, organizationId];
  const tabs = await pool.query<{ tab_key: string; label: string; sort_order: number; asset_group_id: string | null }>(
    STORED_TABS_SQL,
    params,
  );
  const widgets = await pool.query<{
    id: string;
    tab_key: string;
    widget_type: string;
    title: string | null;
    grid_x: number;
    grid_y: number;
    grid_w: number;
    grid_h: number;
    config: unknown;
  }>(STORED_WIDGETS_SQL, params);
  const points = await pool.query<{ widget_id: string; point_id: string; role: string; sort_order: number }>(
    STORED_POINTS_SQL,
    params,
  );
  const sources = await pool.query<{ widget_id: string; catalog_key: string; params: unknown; sort_order: number }>(
    STORED_SOURCES_SQL,
    params,
  );
  return copyFingerprint(
    tabs.rows.map((row) => ({
      tabKey: row.tab_key,
      label: row.label,
      sortOrder: row.sort_order,
      assetGroupId: row.asset_group_id,
    })),
    widgets.rows.map((row) => ({
      tabKey: row.tab_key,
      widgetType: row.widget_type,
      title: row.title,
      gridX: row.grid_x,
      gridY: row.grid_y,
      gridW: row.grid_w,
      gridH: row.grid_h,
      config: row.config,
      points: points.rows
        .filter((point) => point.widget_id === row.id)
        .map((point) => ({ pointId: point.point_id, role: point.role, sortOrder: point.sort_order })),
      sources: sources.rows
        .filter((source) => source.widget_id === row.id)
        .map((source) => ({ catalogKey: source.catalog_key, params: source.params, sortOrder: source.sort_order })),
    })),
  );
}

/** Why a location's copy did not move. */
export type PheCopyStayReason = "no_location" | "no_copy" | "not_smoc_standard" | "edited" | "not_plannable";

export type PheCopyMoveOutcome = {
  readonly moved: readonly { readonly locationId: string; readonly dashboardId: string }[];
  readonly stayed: readonly { readonly locationId: string; readonly reason: PheCopyStayReason }[];
};

/** Moves each untouched `smoc-standard` copy at `locationIds` to `to` (see the file docblock). */
export async function moveUntouchedPheCopies(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  options: {
    readonly from: SeededSiteTemplate;
    readonly to: SeededSiteTemplate;
    readonly locationIds: readonly string[];
    readonly fromChoice: Readonly<Record<string, string>>;
    readonly toChoice: Readonly<Record<string, string>>;
    readonly log?: (line: string) => void;
  },
): Promise<PheCopyMoveOutcome> {
  const log = options.log ?? ((line: string) => console.error(line));
  const moved: { locationId: string; dashboardId: string }[] = [];
  const stayed: { locationId: string; reason: PheCopyStayReason }[] = [];
  // A copy already moved, or one an admin replaced, is not a candidate: say nothing about it.
  const stay = (locationId: string, reason: PheCopyStayReason): void => {
    stayed.push({ locationId, reason });
    if (reason === "edited" || reason === "not_plannable") {
      log(`moveUntouchedPheCopies: the copy at location ${locationId} stays on smoc-standard: ${reason}`);
    }
  };
  let points: Map<string, string> | null = null;

  for (const locationId of options.locationIds) {
    const location = (await pool.query<{ slug: string; name: string }>(LOCATION_SQL, [locationId, organizationId])).rows[0];
    if (!location) {
      stay(locationId, "no_location");
      continue;
    }
    const copy = (
      await pool.query<{
        id: string;
        name: string;
        description: string | null;
        stock_version: number | null;
        template_id: string;
        template_code: string;
      }>(CANDIDATE_SQL, [locationId, organizationId, siteLayoutSlug(location.slug)])
    ).rows[0];
    if (!copy) {
      stay(locationId, "no_copy");
      continue;
    }
    if (copy.template_code !== SMOC_STANDARD_SITE_TEMPLATE.code) {
      stay(locationId, "not_smoc_standard");
      continue;
    }
    if (
      copy.stock_version !== options.from.stockVersion ||
      copy.name !== `${location.name} site layout` ||
      copy.description !== SITE_LAYOUT_COPY_DESCRIPTION
    ) {
      stay(locationId, "edited");
      continue;
    }
    points ??= await activePointsByAsset(pool, organizationId);
    const expected = await planSiteCopy(pool, organizationId, locationId, options.from, options.fromChoice, points);
    if (expected.status !== "planned") {
      stay(locationId, "not_plannable");
      continue;
    }
    if ((await storedFingerprint(pool, organizationId, copy.id)) !== plannedCopyFingerprint(expected.tabs)) {
      stay(locationId, "edited");
      continue;
    }
    const next = await planSiteCopy(pool, organizationId, locationId, options.to, options.toChoice, points);
    if (next.status !== "planned") {
      stay(locationId, "not_plannable");
      continue;
    }

    await pool.query(DELETE_WIDGETS_SQL, [copy.id, organizationId]);
    await pool.query(DELETE_TABS_SQL, [copy.id, organizationId]);
    const widgetCount = await writeSiteLayoutTabs(pool, organizationId, copy.id, locationId, next.tabs);
    const stamped = await pool.query(RESTAMP_SQL, [
      copy.id,
      organizationId,
      options.to.id,
      options.to.stockVersion,
      PUMP_STATION_COPY_DESCRIPTION,
      copy.template_id,
      copy.stock_version,
    ]);
    const check = (await pool.query<{ tabs: number; widgets: number }>(READ_BACK_SQL, [copy.id])).rows[0];
    if (stamped.rowCount !== 1 || check?.tabs !== next.tabs.length || check.widgets !== widgetCount) {
      throw new Error(
        `moveUntouchedPheCopies: the copy ${copy.id} restamped ${stamped.rowCount} of 1 rows and reads back ` +
          `${check?.tabs} of ${next.tabs.length} tabs and ${check?.widgets} of ${widgetCount} widgets. A FORCE-RLS ` +
          "write can drop rows without raising: check this runs inside the organization's tenant bracket.",
      );
    }
    moved.push({ locationId, dashboardId: copy.id });
  }
  return { moved, stayed };
}

/**
 * PHEWB: the templates, then a copy at each catalog station (`F4.319`, ADR 0113 decision 8, plan
 * D7). `smoc-standard` is still imported and its upgrade chain still runs, so a copy at an older
 * stock shape reaches the current one first; then each untouched `smoc-standard` copy moves to
 * `pump-station-standard`, and a station with no copy yet gets one made from
 * `pump-station-standard` directly.
 */
export async function seedPhewbSiteLayouts(
  pool: Pick<pg.Pool, "query">,
  phewbOrgId: string,
  pheCatalog: PheCatalogFile,
  log?: (line: string) => void,
): Promise<SiteLayoutSeedOutcome> {
  const say = log ?? ((line: string) => console.error(line));
  const smoc = await ensureSiteTemplate(pool, phewbOrgId);
  const station = await ensureSiteTemplate(pool, phewbOrgId, PUMP_STATION_STANDARD_SITE_TEMPLATE);
  const locationIds = await resolvePhewbSiteLayoutLocations(pool, phewbOrgId, pheSiteLayoutStations(pheCatalog));
  // The smoc chain runs whenever smoc-standard is published, as before F4.319, so the copies that
  // stay on it keep their upgrades even while pump-station-standard is an unpublished draft.
  if (smoc !== null) {
    await upgradeSeededSiteLayoutCopies(pool, phewbOrgId, locationIds, SITE_LAYOUT_SLUG_PREFIX);
  }
  if (station === null) {
    say("seedPhewbSiteLayouts: no published pump-station-standard template; no copy made");
    return { made: [], skipped: [] };
  }
  if (smoc !== null) {
    await moveUntouchedPheCopies(pool, phewbOrgId, {
      from: smoc,
      to: station,
      locationIds,
      fromChoice: SITE_LAYOUT_PHEWB_CHOICE,
      toChoice: SITE_LAYOUT_PHEWB_PUMP_STATION_CHOICE,
      log: say,
    });
  }
  return seedSiteLayouts(pool, phewbOrgId, {
    template: station,
    locationIds,
    choiceByGroupCode: SITE_LAYOUT_PHEWB_PUMP_STATION_CHOICE,
    description: PUMP_STATION_COPY_DESCRIPTION,
    ...(log ? { log } : {}),
  });
}
