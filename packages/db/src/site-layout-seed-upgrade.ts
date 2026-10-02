import type pg from "pg";

import {
  isUnboundRoleTile,
  packAfterRemoval,
  type SectionTemplateContent,
  sectionTemplateContentSchema,
} from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  type OverviewV3UpgradePlan,
  planElectricalV4Upgrade,
  planOverviewV3Upgrade,
  planOverviewV4Upgrade,
  type TabCopyWidget,
  type TabUpgradePlan,
} from "./site-layout-seed-upgrade-tabs";
import {
  type GridRect,
  SMOC_STANDARD_V1_RECTS,
  SMOC_STANDARD_V2_RECTS,
  siteTemplateRects,
  siteWidgetIdentity,
  smocStandardV2Content,
  smocStandardV3Content,
} from "./site-layout-stock-history";

export { type GridRect, siteTemplateRects, siteWidgetIdentity } from "./site-layout-stock-history";

/**
 * The SMOC standard site layout's seed upgrade chain, for a database an earlier seed already ran
 * on. It moves the seed's own rows to the current stock version and leaves every row an
 * administrator touched. The past versions it recognises are frozen in
 * `site-layout-stock-history.ts`, and the per-tab planners are `site-layout-seed-upgrade-tabs.ts`.
 * **The next version (v5) adds its step here**: freeze v4 there, then add the step after
 * {@link upgradeElectricalV4} in {@link upgradeSeededSiteLayoutCopies}.
 *
 * **The chain, per seed-owned copy, in order** (the locations `site-layout-seed.ts` resolves,
 * the slug it gives, a `smoc-standard` template stamp):
 *
 * 1. **v1 → v2** ({@link planCopyWidgetUpgrade}): stock version 2 compacts each widget's height.
 *    The description changes only while it still equals {@link SITE_LAYOUT_COPY_DESCRIPTION_V1}
 *    exactly, and a TAB's widgets move to the v2 rects only while every widget in it still holds
 *    its v1 rect. The gate is per tab, not per widget: moving the rest of a tab around one widget
 *    an administrator moved could stack the two.
 * 2. **v2 → packed** ({@link planCopyPackUpgrade}, ADR 0087 Amendment 2): a copy-time rule, not
 *    template content — pack the kept Overview cards left and leave out a role tile that binds no
 *    point at the site, per tab, only while the tab is exactly as the v2 seed wrote it.
 * 3. **v2 → v3 Overview** ({@link planOverviewUpgrade}, ADR 0087 Amendment 3): only while the
 *    Overview holds exactly its own packed v2 plan, delete its module cards and move the rest to
 *    the v3 rects and config. The domain tabs did not change in v3.
 * 4. **v3 → v4** (`F3.74`, ADR 0088 Amendment 2), two steps gated per tab (OQ-A): an Overview
 *    still at v3 as the copy rule left it gains the compact electrical diagram and its class strip
 *    moves beside it ({@link upgradeOverviewV4}); an electrical tab still at v3 draws
 *    `lv_single_line`, gains the "Breakers" table under the mimic, and its alarm rail and asset
 *    table move down five rows ({@link upgradeElectricalV4}). Both insert a widget row with no
 *    binding row. The other tabs did not change in v4.
 *
 * A copy stores no widget key, so a widget is known by its tab key, widget type and title
 * ({@link siteWidgetIdentity}), which is unique per tab.
 *
 * **The template.** A published row is never edited (ADR 0049 — the lifecycle's `update` takes
 * drafts only), so its stock stamp is its content. When the organization's newest
 * `smoc-standard` row is the seed's own at an older stock version ({@link isSeedStockSiteTemplate}),
 * the seed adds the next version as a published row holding the current content and archives the
 * older row, the explicit archive the lifecycle performs (`publish` alone archives nothing). Any
 * newer row — an administrator's draft or version — leaves both alone. The copies keep their
 * `template_id` stamp.
 *
 * **Idempotent.** Each step's gate is the exact shape its own previous step wrote, so a second
 * run finds nothing to do and writes nothing. Every write runs in the caller's
 * `withOrganization` bracket, holds the read values in its predicate and checks its row count: a
 * FORCE-RLS write can drop a row without raising.
 */

/** The copy's description since stock version 2. */
export const SITE_LAYOUT_COPY_DESCRIPTION =
  "SMOC standard site layout: an Overview and one tab for each asset domain at this site.";

/** The copy's description the v1 seed wrote; only this exact text is replaced. */
export const SITE_LAYOUT_COPY_DESCRIPTION_V1 = "The SMOC standard site layout, seeded for this demo site (F3.73).";

/** The current stock entry's rects. */
export const SMOC_STANDARD_CURRENT_RECTS: ReadonlyMap<string, GridRect> = siteTemplateRects(
  SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent,
);

function sameRect(a: GridRect, b: GridRect): boolean {
  return a.gridX === b.gridX && a.gridY === b.gridY && a.gridW === b.gridW && a.gridH === b.gridH;
}

/** The description to write, or `null` to keep the current one (an administrator's text). */
export function upgradedCopyDescription(current: string | null): string | null {
  return current === SITE_LAYOUT_COPY_DESCRIPTION_V1 ? SITE_LAYOUT_COPY_DESCRIPTION : null;
}

/** One stored widget of a copy. */
export type CopyWidget = GridRect & {
  readonly id: string;
  readonly tabKey: string;
  readonly widgetType: string;
  readonly title: string | null;
};

/**
 * The widgets to move, each with its new rect. A tab moves only when every widget in it is a
 * template widget at its `from` rect, no identity repeats, and `to` holds a rect for each;
 * otherwise the whole tab is kept. `to` is the frozen v2 shape, not the live one: the steps after
 * this one take a copy on from v2.
 */
export function planCopyWidgetUpgrade(
  widgets: readonly CopyWidget[],
  from: ReadonlyMap<string, GridRect> = SMOC_STANDARD_V1_RECTS,
  to: ReadonlyMap<string, GridRect> = SMOC_STANDARD_V2_RECTS,
): { readonly id: string; readonly from: GridRect; readonly to: GridRect }[] {
  const byTab = new Map<string, CopyWidget[]>();
  for (const widget of widgets) {
    byTab.set(widget.tabKey, [...(byTab.get(widget.tabKey) ?? []), widget]);
  }
  const moves: { id: string; from: GridRect; to: GridRect }[] = [];
  for (const tabWidgets of byTab.values()) {
    const seen = new Set<string>();
    const tabMoves: { id: string; from: GridRect; to: GridRect }[] = [];
    let keep = false;
    for (const widget of tabWidgets) {
      const identity = siteWidgetIdentity(widget.tabKey, widget.widgetType, widget.title);
      const fromRect = from.get(identity);
      const toRect = to.get(identity);
      if (seen.has(identity) || !fromRect || !toRect || !sameRect(widget, fromRect)) {
        keep = true;
        break;
      }
      seen.add(identity);
      if (!sameRect(fromRect, toRect)) tabMoves.push({ id: widget.id, from: fromRect, to: toRect });
    }
    if (!keep) moves.push(...tabMoves);
  }
  return moves;
}

/** One stored widget of a copy, with the point and source rows it holds. */
export type PackCopyWidget = CopyWidget & { readonly points: number; readonly sources: number };

/**
 * The v2 → packed step (the F3.73 design critique, findings a and b): what the seed's copy rule
 * now leaves out and packs, applied to a copy the earlier seed made. Per tab, and only while the
 * tab holds **exactly** what that seed wrote: every template widget of the tab once, at its
 * v2 stock rect, less the Overview cards of tabs the copy does not have. A tab with a
 * widget moved, added or deleted by an administrator is left whole.
 *
 * In a kept tab, a role tile holding no point and no source row is deleted (it bound nothing at
 * the site, `isUnboundRoleTile`), and the rest of the tab is packed by `packAfterRemoval` in
 * template order — the same function and order the copy action runs, so an upgraded copy lands
 * where a fresh one would.
 *
 * Idempotent by its gate: a packed tab no longer stands at the stock rects, so a second run finds
 * nothing to do. A tab nothing is removed from packs to the rects it holds and writes nothing.
 */
export function planCopyPackUpgrade(
  widgets: readonly PackCopyWidget[],
  copyTabKeys: readonly string[],
  content: SectionTemplateContent = smocStandardV2Content(),
): { readonly moves: { id: string; from: GridRect; to: GridRect }[]; readonly deletes: { id: string; from: GridRect }[] } {
  const tabs = new Set(copyTabKeys);
  const moves: { id: string; from: GridRect; to: GridRect }[] = [];
  const deletes: { id: string; from: GridRect }[] = [];
  for (const tab of content.tabs) {
    const stored = widgets.filter((widget) => widget.tabKey === tab.key);
    if (!tabs.has(tab.key) || stored.length === 0) continue;
    const byIdentity = new Map(stored.map((widget) => [siteWidgetIdentity(tab.key, widget.widgetType, widget.title), widget]));
    const expected = tab.widgets.filter(
      (widget) => widget.widgetType !== "module_summary_card" || tabs.has(widget.config.targetTabKey),
    );
    const exact =
      byIdentity.size === stored.length &&
      stored.length === expected.length &&
      expected.every((widget) => {
        const row = byIdentity.get(siteWidgetIdentity(tab.key, widget.widgetType, widget.title));
        return row !== undefined && sameRect(row, widget);
      });
    if (!exact) continue;

    const rowOf = (widget: (typeof tab.widgets)[number]): PackCopyWidget | undefined =>
      byIdentity.get(siteWidgetIdentity(tab.key, widget.widgetType, widget.title));
    const unbound = (widget: (typeof tab.widgets)[number], row: PackCopyWidget): boolean =>
      row.sources === 0 && isUnboundRoleTile(widget, row.points);
    const keep = (widget: (typeof tab.widgets)[number]): boolean => {
      const row = rowOf(widget);
      return row !== undefined && !unbound(widget, row);
    };
    const keptTemplate = tab.widgets.filter(keep);
    const packed = packAfterRemoval(tab.widgets, keep);
    for (const [index, widget] of keptTemplate.entries()) {
      const row = rowOf(widget) as PackCopyWidget;
      const to = packed[index] as GridRect;
      const from = { gridX: row.gridX, gridY: row.gridY, gridW: row.gridW, gridH: row.gridH };
      if (!sameRect(from, to)) {
        moves.push({ id: row.id, from, to: { gridX: to.gridX, gridY: to.gridY, gridW: to.gridW, gridH: to.gridH } });
      }
    }
    for (const widget of tab.widgets) {
      const row = rowOf(widget);
      if (row !== undefined && unbound(widget, row)) {
        deletes.push({ id: row.id, from: { gridX: row.gridX, gridY: row.gridY, gridW: row.gridW, gridH: row.gridH } });
      }
    }
  }
  return { moves, deletes };
}

/** One stored widget of a copy, with its bindings' row counts and its `config`. */
export type OverviewCopyWidget = PackCopyWidget & { readonly config: unknown };

/** The v2 → v3 Overview step's writes: deletes, updates (rect or config) and inserts. */
export type OverviewUpgradePlan = OverviewV3UpgradePlan;

/**
 * The v2 → v3 Overview step (`F3.77` plan D5, ADR 0087 Amendment 3), planned by
 * `planOverviewV3Upgrade` (`site-layout-seed-upgrade-tabs.ts`). The gate: the copy's stored
 * Overview equals `from`'s Overview as the copy rule left it — `packAfterRemoval` over `from`'s
 * widgets, keeping a module card only when its target tab is one of `copyTabKeys` — exactly:
 * the same identities, none repeated, nothing added, the same rects, the same `config` (compared
 * without key order, as `jsonb` stores it), no point row, and each widget's source rows as many
 * as its template sources. Anything else is an administrator's Overview, left whole.
 *
 * In a matching Overview, a widget `to` does not hold is deleted (v3: every module card), and a
 * widget whose `to` rect or config differs is updated (v3: everything else, the Offline tile to
 * the `offline` icon). The title is kept (owner ruling OQ1), so the identity holds across the
 * step. A widget new in `to` is an insert (v3 has none).
 *
 * `to` defaults to the frozen v3 content, not the live entry: this step is v2 → v3, and the live
 * entry is v4 (`F3.74`), whose Overview holds a widget v3 does not.
 *
 * Idempotent by its gate: an Overview at `to` no longer holds `from`'s cards and rects.
 */
export function planOverviewUpgrade(
  widgets: readonly OverviewCopyWidget[],
  copyTabKeys: readonly string[],
  from: SectionTemplateContent = smocStandardV2Content(),
  to: SectionTemplateContent = smocStandardV3Content(),
): OverviewUpgradePlan {
  return planOverviewV3Upgrade(widgets, copyTabKeys, from, to);
}

/** A template row as the upgrade reads it. */
export type SiteTemplateRow = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly stockVersion: number | null;
  readonly createdBy: string | null;
  readonly content: unknown;
};

/**
 * Whether `newest` (the organization's highest `smoc-standard` version, any status) is the
 * seed's own row at an older stock version — the one row the upgrade supersedes (ADR 0087
 * Amendment 3 ruling 9, owner ruling OQ7): published, no author, a stock stamp below
 * `currentStockVersion`, and content that parses. No per-version rects check: a published row is
 * immutable (ADR 0049), so its stamp is its content.
 */
export function isSeedStockSiteTemplate(
  newest: SiteTemplateRow | undefined,
  currentStockVersion: number = SMOC_STANDARD_SITE_TEMPLATE.stockVersion,
): boolean {
  if (
    !newest ||
    newest.status !== "published" ||
    newest.createdBy !== null ||
    newest.stockVersion === null ||
    !(newest.stockVersion < currentStockVersion)
  ) {
    return false;
  }
  return sectionTemplateContentSchema.safeParse(newest.content).success;
}

const NEWEST_TEMPLATE_SQL = `
  SELECT id, version, status, stock_version, created_by, content
    FROM bms.dashboard_templates
   WHERE organization_id = $1 AND code = $2
   ORDER BY version DESC
   LIMIT 1
`;
const NEXT_TEMPLATE_INSERT_SQL = `
  INSERT INTO bms.dashboard_templates
    (organization_id, code, version, name, section, target, description, status, content,
     published_at, stock_code, stock_version)
  VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8::jsonb, now(), $2, $9)
  ON CONFLICT (organization_id, code, version) DO NOTHING
  RETURNING id
`;
const TEMPLATE_ARCHIVE_SQL = `
  UPDATE bms.dashboard_templates
     SET status = 'archived', archived_at = now(), updated_at = now()
   WHERE id = $1 AND organization_id = $2 AND status = 'published'
`;

/**
 * Supersedes the seed's own older `smoc-standard` row ({@link isSeedStockSiteTemplate}) with the
 * current stock version, published, and archives the older row. Returns the new row's id, or
 * `null` when the newest row is not the seed's own older one.
 */
export async function upgradeSeedSiteTemplate(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
): Promise<string | null> {
  const entry = SMOC_STANDARD_SITE_TEMPLATE;
  const row = (
    await pool.query<{
      id: string;
      version: number;
      status: string;
      stock_version: number | null;
      created_by: string | null;
      content: unknown;
    }>(NEWEST_TEMPLATE_SQL, [organizationId, entry.code])
  ).rows[0];
  const newest: SiteTemplateRow | undefined = row && {
    id: row.id,
    version: row.version,
    status: row.status,
    stockVersion: row.stock_version,
    createdBy: row.created_by,
    content: row.content,
  };
  if (!newest || !isSeedStockSiteTemplate(newest)) return null;

  const inserted = await pool.query<{ id: string }>(NEXT_TEMPLATE_INSERT_SQL, [
    organizationId,
    entry.code,
    newest.version + 1,
    entry.name,
    entry.section,
    entry.target,
    entry.description,
    JSON.stringify(entry.content),
    entry.stockVersion,
  ]);
  const id = inserted.rows[0]?.id;
  if (!id) {
    throw new Error(
      `upgradeSeedSiteTemplate: ${entry.code} v${newest.version + 1} was not written in ${organizationId}. ` +
        "A FORCE-RLS write can drop a row without raising: check this runs inside the organization's tenant bracket.",
    );
  }
  const archived = await pool.query(TEMPLATE_ARCHIVE_SQL, [newest.id, organizationId]);
  if (archived.rowCount !== 1) {
    throw new Error(`upgradeSeedSiteTemplate: archived ${archived.rowCount} of 1 superseded rows in ${organizationId}`);
  }
  return id;
}

/**
 * The seed-owned copies at `locationIds`: slug `prefix` + the location's slug, stamped with a
 * `smoc-standard` template. Params: `[organizationId, locationIds, prefix, code]`.
 */
const SEEDED_COPIES_SQL = `
  SELECT d.id, d.description
    FROM bms.dashboards d
    JOIN bms.locations l ON l.id = d.location_id
    JOIN bms.dashboard_templates t ON t.id = d.template_id
   WHERE d.organization_id = $1
     AND l.id = ANY($2::uuid[])
     AND d.slug = $3 || l.slug
     AND t.code = $4
   ORDER BY d.slug
`;
const COPY_WIDGETS_SQL = `
  SELECT w.id, t.tab_key, w.widget_type, w.title, w.grid_x, w.grid_y, w.grid_w, w.grid_h
    FROM bms.dashboard_widgets w
    JOIN bms.dashboard_tabs t ON t.id = w.tab_id
   WHERE w.dashboard_id = $1 AND w.organization_id = $2
`;
const DESCRIPTION_UPDATE_SQL = `
  UPDATE bms.dashboards SET description = $3, updated_at = now()
   WHERE id = $1 AND organization_id = $2 AND description = $4
`;
/** The `from` rect is in the predicate: a widget that moved since the read is not written. */
const WIDGET_RECT_UPDATE_SQL = `
  UPDATE bms.dashboard_widgets
     SET grid_x = $3, grid_y = $4, grid_w = $5, grid_h = $6, updated_at = now()
   WHERE id = $1 AND organization_id = $2
     AND grid_x = $7 AND grid_y = $8 AND grid_w = $9 AND grid_h = $10
`;

/**
 * The copy's widgets with their config and their point and source row counts — the read of the
 * pack step and the Overview step.
 */
const PACK_WIDGETS_SQL = `
  SELECT w.id, t.tab_key, w.widget_type, w.title, w.grid_x, w.grid_y, w.grid_w, w.grid_h, w.config,
         (SELECT count(*)::int FROM bms.dashboard_widget_points p WHERE p.widget_id = w.id) AS points,
         (SELECT count(*)::int FROM bms.dashboard_widget_sources s WHERE s.widget_id = w.id) AS sources
    FROM bms.dashboard_widgets w
    JOIN bms.dashboard_tabs t ON t.id = w.tab_id
   WHERE w.dashboard_id = $1 AND w.organization_id = $2
`;
const COPY_TABS_SQL = `SELECT id, tab_key FROM bms.dashboard_tabs WHERE dashboard_id = $1 AND organization_id = $2`;
/**
 * A tab step's insert: the copy's own insert shape (`site-layout-seed.ts`), the widget row only.
 * `RETURNING id` is checked: a FORCE-RLS insert can drop a row without raising.
 */
const WIDGET_INSERT_SQL = `
  INSERT INTO bms.dashboard_widgets
    (organization_id, dashboard_id, tab_id, widget_type, title, grid_x, grid_y, grid_w, grid_h, config)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
  RETURNING id
`;
/** The rect and the empty bindings are in the predicate: a tile bound or moved since the read stays. */
const UNBOUND_TILE_DELETE_SQL = `
  DELETE FROM bms.dashboard_widgets w
   WHERE w.id = $1 AND w.organization_id = $2 AND w.widget_type = 'value_tile'
     AND w.grid_x = $3 AND w.grid_y = $4 AND w.grid_w = $5 AND w.grid_h = $6
     AND NOT EXISTS (SELECT 1 FROM bms.dashboard_widget_points p WHERE p.widget_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM bms.dashboard_widget_sources s WHERE s.widget_id = w.id)
`;
/**
 * The Overview step's delete. The type, rect and config read are in the predicate, and the step's
 * gate read no point row: a widget an administrator edited or bound since the read stays.
 */
const CARD_DELETE_SQL = `
  DELETE FROM bms.dashboard_widgets w
   WHERE w.id = $1 AND w.organization_id = $2 AND w.widget_type = $3
     AND w.grid_x = $4 AND w.grid_y = $5 AND w.grid_w = $6 AND w.grid_h = $7
     AND w.config = $8::jsonb
     AND NOT EXISTS (SELECT 1 FROM bms.dashboard_widget_points p WHERE p.widget_id = w.id)
`;
/** The Overview step's update: rect and config, with the rect, title and config read in the predicate. */
const WIDGET_UPGRADE_SQL = `
  UPDATE bms.dashboard_widgets
     SET grid_x = $3, grid_y = $4, grid_w = $5, grid_h = $6, config = $7::jsonb, updated_at = now()
   WHERE id = $1 AND organization_id = $2
     AND grid_x = $8 AND grid_y = $9 AND grid_w = $10 AND grid_h = $11
     AND title IS NOT DISTINCT FROM $12::text AND config = $13::jsonb
`;

export type SiteLayoutCopyUpgrade = {
  readonly descriptions: number;
  /** Widgets moved from their v1 rect to the v2 one. */
  readonly widgets: number;
  /** Widgets moved by the pack step. */
  readonly packed: number;
  /** Unbound role tiles the pack step deleted. */
  readonly omittedTiles: number;
  /** Overviews the v2 → v3 step moved. */
  readonly overviews: number;
  /** Overviews the v3 → v4 step moved (the compact diagram and the strip). */
  readonly overviewsV4: number;
  /** Electrical tabs the v3 → v4 step moved (`lv_single_line` and the breaker table). */
  readonly electricalTabs: number;
};

type PackWidgetRow = {
  id: string;
  tab_key: string;
  widget_type: string;
  title: string | null;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  config: unknown;
  points: number;
  sources: number;
};

/** A copy's widgets, tab keys and tab ids by key, as the pack and tab steps read them. */
async function readCopy(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
): Promise<{ widgets: TabCopyWidget[]; tabKeys: string[]; tabIds: Map<string, string> }> {
  const stored = await pool.query<PackWidgetRow>(PACK_WIDGETS_SQL, [dashboardId, organizationId]);
  const tabs = await pool.query<{ id: string; tab_key: string }>(COPY_TABS_SQL, [dashboardId, organizationId]);
  return {
    widgets: stored.rows.map((row) => ({
      id: row.id,
      tabKey: row.tab_key,
      widgetType: row.widget_type,
      title: row.title,
      gridX: row.grid_x,
      gridY: row.grid_y,
      gridW: row.grid_w,
      gridH: row.grid_h,
      config: row.config,
      points: row.points,
      sources: row.sources,
    })),
    tabKeys: tabs.rows.map((row) => row.tab_key),
    tabIds: new Map(tabs.rows.map((row) => [row.tab_key, row.id])),
  };
}

/**
 * One tab step's writes on one copy, each checked: deletes, then moves, then updates, then
 * inserts. The electrical step's order is the ADR's: the rail and table down first, then the
 * mimic's config, then the breaker table in the rows they left. `label` names the tab in an error.
 */
async function applyTabPlan(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
  tabIds: ReadonlyMap<string, string>,
  plan: Pick<TabUpgradePlan, "deletes" | "updates" | "inserts"> & Partial<Pick<TabUpgradePlan, "moves">>,
  label: string,
): Promise<void> {
  for (const op of plan.deletes) {
    const res = await pool.query(CARD_DELETE_SQL, [
      op.id,
      organizationId,
      op.widgetType,
      op.from.gridX,
      op.from.gridY,
      op.from.gridW,
      op.from.gridH,
      JSON.stringify(op.config),
    ]);
    if (res.rowCount !== 1) {
      throw new Error(`upgradeSeededSiteLayoutCopies: ${label} widget ${op.id} deleted ${res.rowCount} of 1 rows`);
    }
  }
  for (const move of plan.moves ?? []) {
    await moveWidget(pool, organizationId, move);
  }
  for (const op of plan.updates) {
    const res = await pool.query(WIDGET_UPGRADE_SQL, [
      op.id,
      organizationId,
      op.to.gridX,
      op.to.gridY,
      op.to.gridW,
      op.to.gridH,
      JSON.stringify(op.toConfig),
      op.from.gridX,
      op.from.gridY,
      op.from.gridW,
      op.from.gridH,
      op.title,
      JSON.stringify(op.fromConfig),
    ]);
    if (res.rowCount !== 1) {
      throw new Error(`upgradeSeededSiteLayoutCopies: ${label} widget ${op.id} updated ${res.rowCount} of 1 rows`);
    }
  }
  for (const op of plan.inserts) {
    const tabId = tabIds.get(op.tabKey);
    if (tabId === undefined) {
      throw new Error(`upgradeSeededSiteLayoutCopies: copy ${dashboardId} has no ${op.tabKey} tab for its ${op.widgetType} insert`);
    }
    const res = await pool.query<{ id: string }>(WIDGET_INSERT_SQL, [
      organizationId,
      dashboardId,
      tabId,
      op.widgetType,
      op.title,
      op.to.gridX,
      op.to.gridY,
      op.to.gridW,
      op.to.gridH,
      JSON.stringify(op.config),
    ]);
    if (!res.rows[0]?.id) {
      throw new Error(
        `upgradeSeededSiteLayoutCopies: the ${op.tabKey} ${op.widgetType} insert returned no row in copy ${dashboardId}. ` +
          "A FORCE-RLS write can drop a row without raising: check this runs inside the organization's tenant bracket.",
      );
    }
  }
}

/** Whether a plan writes anything. */
const writes = (plan: Pick<TabUpgradePlan, "deletes" | "updates" | "inserts"> & Partial<Pick<TabUpgradePlan, "moves">>): boolean =>
  plan.deletes.length + plan.updates.length + plan.inserts.length + (plan.moves?.length ?? 0) > 0;

/**
 * The v2 → v3 Overview step on one copy ({@link planOverviewUpgrade}), read after the pack step
 * moved its cards. Returns 1 when it wrote the Overview, else 0.
 */
async function upgradeOverview(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
): Promise<number> {
  const copy = await readCopy(pool, organizationId, dashboardId);
  const plan = planOverviewUpgrade(copy.widgets, copy.tabKeys);
  await applyTabPlan(pool, organizationId, dashboardId, copy.tabIds, plan, "Overview");
  return writes(plan) ? 1 : 0;
}

/**
 * The v3 → v4 Overview step on one copy (`planOverviewV4Upgrade`), read after the v2 → v3 step.
 * Returns 1 when it wrote the Overview, else 0.
 */
async function upgradeOverviewV4(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
): Promise<number> {
  const copy = await readCopy(pool, organizationId, dashboardId);
  const plan = planOverviewV4Upgrade(copy.widgets, copy.tabKeys);
  await applyTabPlan(pool, organizationId, dashboardId, copy.tabIds, plan, "Overview");
  return writes(plan) ? 1 : 0;
}

/**
 * The v3 → v4 electrical step on one copy (`planElectricalV4Upgrade`), gated apart from the
 * Overview (ADR 0088 Amendment 2 OQ-A). Returns 1 when it wrote the electrical tab, else 0.
 */
async function upgradeElectricalV4(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
): Promise<number> {
  const copy = await readCopy(pool, organizationId, dashboardId);
  const plan = planElectricalV4Upgrade(copy.widgets);
  await applyTabPlan(pool, organizationId, dashboardId, copy.tabIds, plan, "electrical tab");
  return writes(plan) ? 1 : 0;
}

/** One rect update, checked: the `from` rect is in the predicate. */
async function moveWidget(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  move: { readonly id: string; readonly from: GridRect; readonly to: GridRect },
): Promise<void> {
  const res = await pool.query(WIDGET_RECT_UPDATE_SQL, [
    move.id,
    organizationId,
    move.to.gridX,
    move.to.gridY,
    move.to.gridW,
    move.to.gridH,
    move.from.gridX,
    move.from.gridY,
    move.from.gridW,
    move.from.gridH,
  ]);
  if (res.rowCount !== 1) {
    throw new Error(`upgradeSeededSiteLayoutCopies: widget ${move.id} updated ${res.rowCount} of 1 rows`);
  }
}

/** The pack step on one copy ({@link planCopyPackUpgrade}): deletes first, then moves. */
async function packCopy(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  dashboardId: string,
): Promise<{ packed: number; omittedTiles: number }> {
  const copy = await readCopy(pool, organizationId, dashboardId);
  const plan = planCopyPackUpgrade(copy.widgets, copy.tabKeys);
  for (const tile of plan.deletes) {
    const res = await pool.query(UNBOUND_TILE_DELETE_SQL, [
      tile.id,
      organizationId,
      tile.from.gridX,
      tile.from.gridY,
      tile.from.gridW,
      tile.from.gridH,
    ]);
    if (res.rowCount !== 1) {
      throw new Error(`upgradeSeededSiteLayoutCopies: unbound tile ${tile.id} deleted ${res.rowCount} of 1 rows`);
    }
  }
  for (const move of plan.moves) {
    await moveWidget(pool, organizationId, move);
  }
  return { packed: plan.moves.length, omittedTiles: plan.deletes.length };
}

/**
 * Moves each seed-owned copy at `locationIds` along the chain: to v2 where it still holds the v1
 * seed's values, then packs each tab still exactly as the seed wrote it ({@link planCopyPackUpgrade}),
 * then moves an Overview still at its packed v2 plan to v3 ({@link planOverviewUpgrade}), then
 * moves an Overview and an electrical tab still at v3 to v4, each on its own gate.
 */
export async function upgradeSeededSiteLayoutCopies(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  locationIds: readonly string[],
  slugPrefix: string,
): Promise<SiteLayoutCopyUpgrade> {
  const copies = await pool.query<{ id: string; description: string | null }>(SEEDED_COPIES_SQL, [
    organizationId,
    locationIds,
    slugPrefix,
    SMOC_STANDARD_SITE_TEMPLATE.code,
  ]);
  let descriptions = 0;
  let widgets = 0;
  let packed = 0;
  let omittedTiles = 0;
  let overviews = 0;
  let overviewsV4 = 0;
  let electricalTabs = 0;
  for (const copy of copies.rows) {
    const description = upgradedCopyDescription(copy.description);
    if (description !== null) {
      const res = await pool.query(DESCRIPTION_UPDATE_SQL, [
        copy.id,
        organizationId,
        description,
        SITE_LAYOUT_COPY_DESCRIPTION_V1,
      ]);
      if (res.rowCount !== 1) {
        throw new Error(`upgradeSeededSiteLayoutCopies: the description of ${copy.id} updated ${res.rowCount} of 1 rows`);
      }
      descriptions += 1;
    }
    const stored = await pool.query<{
      id: string;
      tab_key: string;
      widget_type: string;
      title: string | null;
      grid_x: number;
      grid_y: number;
      grid_w: number;
      grid_h: number;
    }>(COPY_WIDGETS_SQL, [copy.id, organizationId]);
    const moves = planCopyWidgetUpgrade(
      stored.rows.map((row) => ({
        id: row.id,
        tabKey: row.tab_key,
        widgetType: row.widget_type,
        title: row.title,
        gridX: row.grid_x,
        gridY: row.grid_y,
        gridW: row.grid_w,
        gridH: row.grid_h,
      })),
    );
    for (const move of moves) {
      await moveWidget(pool, organizationId, move);
      widgets += 1;
    }
    // After the v1 → v2 moves, so a v1 copy lands packed in the same boot.
    const step = await packCopy(pool, organizationId, copy.id);
    packed += step.packed;
    omittedTiles += step.omittedTiles;
    // After the pack step, which moves the cards the Overview step's gate expects packed.
    overviews += await upgradeOverview(pool, organizationId, copy.id);
    // After the v2 → v3 step, so a copy still at v1 or v2 reaches v4 in the same boot.
    overviewsV4 += await upgradeOverviewV4(pool, organizationId, copy.id);
    electricalTabs += await upgradeElectricalV4(pool, organizationId, copy.id);
  }
  return { descriptions, widgets, packed, omittedTiles, overviews, overviewsV4, electricalTabs };
}
