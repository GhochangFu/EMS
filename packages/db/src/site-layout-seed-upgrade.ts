import type pg from "pg";

import { type SectionTemplateContent, sectionTemplateContentSchema } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

/**
 * The SMOC standard site layout's v1 → v2 upgrade, for a database that already ran the `F3.73`
 * seed (v1 template rows and v1 copies). Stock version 2 compacts each widget's height to its
 * content; this moves the seed's own rows there and leaves every row an administrator touched.
 *
 * **The copies.** For each seed-owned copy (the locations `site-layout-seed.ts` resolves, the
 * slug it gives, a `smoc-standard` template stamp): the description changes only while it still
 * equals {@link SITE_LAYOUT_COPY_DESCRIPTION_V1} exactly, and a TAB's widgets move to the v2
 * rects only while every widget in that tab still holds its v1 rect. A copy stores no widget key,
 * so a widget is known by its tab key, widget type and title ({@link siteWidgetIdentity}), which
 * is unique per tab. The gate is per tab, not per widget: moving the rest of a tab around one
 * widget an administrator moved could stack the two.
 *
 * **The template.** A published row is never edited (ADR 0049 — the lifecycle's `update` takes
 * drafts only). When the organization's newest `smoc-standard` row is still the seed's own v1
 * (version 1, stock version 1, no author, v1 rects), the seed adds the next version as a
 * published row holding the v2 content and archives the v1 row, the explicit archive the
 * lifecycle performs (`publish` alone archives nothing). Any newer row — an administrator's
 * draft or version — leaves both alone. The copies keep their `template_id` stamp on v1.
 *
 * **Idempotent.** A second run finds the v2 rects, the new description and a stock-2 template,
 * and writes nothing. Every write runs in the caller's `withOrganization` bracket and checks its
 * row count: a FORCE-RLS write can drop a row without raising.
 */

/** The copy's description since stock version 2. */
export const SITE_LAYOUT_COPY_DESCRIPTION =
  "SMOC standard site layout: an Overview and one tab for each asset domain at this site.";

/** The copy's description the v1 seed wrote; only this exact text is replaced. */
export const SITE_LAYOUT_COPY_DESCRIPTION_V1 = "The SMOC standard site layout, seeded for this demo site (F3.73).";

export type GridRect = {
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
};

/** How a copy's widget is known: its tab key, widget type and title. */
export function siteWidgetIdentity(tabKey: string, widgetType: string, title: string | null): string {
  return `${tabKey}|${widgetType}|${title ?? ""}`;
}

/**
 * Stock version 1's rects, `[x, y, w, h]`. Read from the copies the v1 seed wrote (every tab
 * but `it`, which no seeded site holds; its rects follow the same v1 rule as the other mimic
 * tabs). Frozen: v1 exists nowhere else in code once stock version 2 ships.
 */
const V1_RECTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
  "overview|state_legend|": [0, 0, 12, 2],
  "overview|value_tile|Active alarms": [0, 2, 3, 4],
  "overview|value_tile|Total load": [3, 2, 3, 4],
  "overview|value_tile|Asset health": [6, 2, 3, 4],
  "overview|value_tile|Offline assets": [9, 2, 3, 4],
  "overview|asset_class_strip|": [0, 6, 12, 3],
  "overview|module_summary_card|Electrical": [0, 9, 2, 4],
  "overview|module_summary_card|UPS & battery": [2, 9, 2, 4],
  "overview|module_summary_card|HVAC": [4, 9, 2, 4],
  "overview|module_summary_card|IT": [6, 9, 2, 4],
  "overview|module_summary_card|Environment": [8, 9, 2, 4],
  "overview|module_summary_card|Water": [10, 9, 2, 4],
  "overview|active_alarms_rail|Active alarms": [0, 13, 6, 8],
  "overview|critical_systems_list|Critical systems": [6, 13, 6, 8],
  "sld|value_tile|Incomer load": [0, 0, 3, 4],
  "sld|value_tile|Incomer power factor": [3, 0, 3, 4],
  "sld|value_tile|Frequency": [6, 0, 3, 4],
  "sld|value_tile|Main bus load": [9, 0, 3, 4],
  "sld|mimic|": [0, 4, 12, 10],
  "sld|active_alarms_rail|Active alarms": [0, 14, 6, 8],
  "sld|table|Assets": [6, 14, 6, 8],
  "ups|value_tile|UPS load": [0, 0, 3, 4],
  "ups|value_tile|Battery backup": [3, 0, 3, 4],
  "ups|active_alarms_rail|Active alarms": [0, 4, 6, 8],
  "ups|table|Assets": [6, 4, 6, 8],
  "hvac|value_tile|Supply air": [0, 0, 3, 4],
  "hvac|value_tile|Return air": [3, 0, 3, 4],
  "hvac|value_tile|Cooling load": [6, 0, 3, 4],
  "hvac|mimic|": [0, 4, 12, 10],
  "hvac|active_alarms_rail|Active alarms": [0, 14, 6, 8],
  "hvac|table|Assets": [6, 14, 6, 8],
  "it|value_tile|Rack load": [0, 0, 3, 4],
  "it|value_tile|PDU utilisation": [3, 0, 3, 4],
  "it|mimic|": [0, 4, 12, 10],
  "it|active_alarms_rail|Active alarms": [0, 14, 6, 8],
  "it|table|Assets": [6, 14, 6, 8],
  "env|value_tile|Room temperature": [0, 0, 3, 4],
  "env|value_tile|Room humidity": [3, 0, 3, 4],
  "env|mimic|": [0, 4, 12, 10],
  "env|active_alarms_rail|Active alarms": [0, 14, 6, 8],
  "env|table|Assets": [6, 14, 6, 8],
  "water|value_tile|Inlet flow": [0, 0, 3, 4],
  "water|value_tile|Treated tank level": [3, 0, 3, 4],
  "water|mimic|": [0, 4, 12, 10],
  "water|active_alarms_rail|Active alarms": [0, 14, 6, 8],
  "water|table|Assets": [6, 14, 6, 8],
};

/** Stock version 1's rects by {@link siteWidgetIdentity}. */
export const SMOC_STANDARD_V1_RECTS: ReadonlyMap<string, GridRect> = new Map(
  Object.entries(V1_RECTS).map(([key, [gridX, gridY, gridW, gridH]]) => [key, { gridX, gridY, gridW, gridH }]),
);

/** A template content's rects by {@link siteWidgetIdentity}. */
export function siteTemplateRects(content: SectionTemplateContent): Map<string, GridRect> {
  const rects = new Map<string, GridRect>();
  for (const tab of content.tabs) {
    for (const widget of tab.widgets) {
      const { gridX, gridY, gridW, gridH } = widget;
      rects.set(siteWidgetIdentity(tab.key, widget.widgetType, widget.title), { gridX, gridY, gridW, gridH });
    }
  }
  return rects;
}

/** The current stock entry's rects — the v2 layout the upgrade moves a copy to. */
export const SMOC_STANDARD_CURRENT_RECTS: ReadonlyMap<string, GridRect> = siteTemplateRects(
  SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent,
);

/** The stock content with every widget at its v1 rect — what the v1 seed stored. */
export function smocStandardV1Content(): SectionTemplateContent {
  const content = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;
  return {
    ...content,
    tabs: content.tabs.map((tab) => ({
      ...tab,
      widgets: tab.widgets.map((widget) => ({
        ...widget,
        ...SMOC_STANDARD_V1_RECTS.get(siteWidgetIdentity(tab.key, widget.widgetType, widget.title)),
      })),
    })),
  };
}

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
 * otherwise the whole tab is kept.
 */
export function planCopyWidgetUpgrade(
  widgets: readonly CopyWidget[],
  from: ReadonlyMap<string, GridRect> = SMOC_STANDARD_V1_RECTS,
  to: ReadonlyMap<string, GridRect> = SMOC_STANDARD_CURRENT_RECTS,
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
 * seed's own unedited v1 row — the one row the upgrade supersedes.
 */
export function isSeedV1SiteTemplate(newest: SiteTemplateRow | undefined): boolean {
  if (
    !newest ||
    newest.version !== 1 ||
    newest.status !== "published" ||
    newest.stockVersion !== 1 ||
    newest.createdBy !== null
  ) {
    return false;
  }
  const parsed = sectionTemplateContentSchema.safeParse(newest.content);
  if (!parsed.success) return false;
  const rects = siteTemplateRects(parsed.data);
  if (rects.size !== SMOC_STANDARD_V1_RECTS.size) return false;
  for (const [identity, rect] of rects) {
    const v1 = SMOC_STANDARD_V1_RECTS.get(identity);
    if (!v1 || !sameRect(rect, v1)) return false;
  }
  return true;
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
 * Supersedes the seed's v1 `smoc-standard` row with the current stock version, published, and
 * archives v1. Returns the new row's id, or `null` when nothing was the seed's v1.
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
  if (!newest || !isSeedV1SiteTemplate(newest)) return null;

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
    throw new Error(`upgradeSeedSiteTemplate: archived ${archived.rowCount} of 1 v1 rows in ${organizationId}`);
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

export type SiteLayoutCopyUpgrade = {
  readonly descriptions: number;
  readonly widgets: number;
};

/** Moves each seed-owned copy at `locationIds` to v2 where it still holds the v1 seed's values. */
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
      widgets += 1;
    }
  }
  return { descriptions, widgets };
}
