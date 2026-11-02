import { DASHBOARD_GRID, MAX_DASHBOARD_WIDGETS, type SectionTemplateContent, TREND_STRIP_WIDGET_ROWS } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import type { GridRect } from "./site-layout-stock-history";

/**
 * `F4.305` (ADR 0108 Amendment 3 items 4, 5 and 8) — the v5 step of the SMOC standard site
 * layout's seed upgrade chain: one `trend_strip` under the top tile row of **every** tab of a
 * seed-owned copy, edited tabs included (a recorded exception to the chain's "leave an edited
 * tab" rule, for this one widget), and every widget below it moved down by the strip's height.
 * The runner (`site-layout-seed-upgrade.ts`) runs it **once per copy**: it reads only copies whose
 * `stock_version` is below {@link TREND_STRIP_STOCK_VERSION} and stamps them after the writes, so
 * a strip an administrator deletes stays deleted (owner answer C5).
 *
 * **The top tile row, by geometry and widget type, no literal (item 8).** Per tab: the `value_tile`
 * widgets at the lowest tile `gridY`; the cut is the lowest bottom edge among them, or `0` with no
 * tile. While any widget crosses the cut (`gridY < cut < gridY + gridH`), the cut rises to that
 * widget's bottom, so the strip at `(0, cut)` overlaps nothing above it; every widget at or below
 * the cut moves down by {@link TREND_STRIP_WIDGET_ROWS}, so it overlaps nothing below it either.
 * A tab that already holds a `trend_strip` is left whole. So is a tab already at the per-tab cap
 * ({@link MAX_DASHBOARD_WIDGETS}, `F4.305` review): a widget past it would make every later builder
 * save of that dashboard a 400 (`tabRulesHold`). The runner stamps the copy all the same.
 *
 * **Config (owner answer C1).** A tab with no bound group (the Overview) gets the whole site,
 * `{ defaultRange }`; a tab bound to a group gets `{ tabKey: <its own key>, defaultRange }`, so the
 * strip reads the group that tab binds. The title and the default range are the stock entry's.
 */

/** The stock version this step brings a copy to; the runner's read and stamp. */
export const TREND_STRIP_STOCK_VERSION = 5;

/** One stored widget of a copy, as the step reads it. */
export type V5CopyWidget = GridRect & {
  readonly id: string;
  readonly tabKey: string;
  readonly widgetType: string;
  readonly title: string | null;
};

/** One tab of a copy: its key and its bound group (`null`: none, the whole site). */
export type V5CopyTab = { readonly key: string; readonly assetGroupId: string | null };

/** The step's writes, in the shape the runner's tab-plan writer takes. */
export type TrendStripV5Plan = {
  readonly moves: readonly { id: string; from: GridRect; to: GridRect }[];
  readonly inserts: readonly { tabKey: string; widgetType: string; title: string | null; to: GridRect; config: unknown }[];
};

const TREND_STRIP = "trend_strip";
const VALUE_TILE = "value_tile";

/** The stock entry's strip: its title and default range, read rather than restated. */
function stockTrendStrip(): { title: string | null; defaultRange: string } {
  const content = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;
  for (const tab of content.tabs) {
    for (const widget of tab.widgets) {
      if (widget.widgetType === TREND_STRIP) {
        return { title: widget.title, defaultRange: (widget.config as { defaultRange: string }).defaultRange };
      }
    }
  }
  throw new Error("planTrendStripV5Upgrade: the stock site template holds no trend_strip widget");
}

const rectOf = (widget: GridRect): GridRect => ({
  gridX: widget.gridX,
  gridY: widget.gridY,
  gridW: widget.gridW,
  gridH: widget.gridH,
});

/** The row the strip goes on: under the top tile row, past every widget that crosses it. */
function cutOf(widgets: readonly V5CopyWidget[]): number {
  const tiles = widgets.filter((widget) => widget.widgetType === VALUE_TILE);
  let cut = 0;
  if (tiles.length > 0) {
    const top = Math.min(...tiles.map((tile) => tile.gridY));
    cut = Math.min(...tiles.filter((tile) => tile.gridY === top).map((tile) => tile.gridY + tile.gridH));
  }
  for (;;) {
    const crossing = widgets.filter((widget) => widget.gridY < cut && cut < widget.gridY + widget.gridH);
    if (crossing.length === 0) return cut;
    cut = Math.max(...crossing.map((widget) => widget.gridY + widget.gridH));
  }
}

/** The v5 step's plan for one copy: per tab of `tabs`, one strip insert and the moves under it. */
export function planTrendStripV5Upgrade(widgets: readonly V5CopyWidget[], tabs: readonly V5CopyTab[]): TrendStripV5Plan {
  const stock = stockTrendStrip();
  const moves: { id: string; from: GridRect; to: GridRect }[] = [];
  const inserts: { tabKey: string; widgetType: string; title: string | null; to: GridRect; config: unknown }[] = [];
  const ordered = [...tabs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const tab of ordered) {
    const stored = widgets
      .filter((widget) => widget.tabKey === tab.key)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (stored.some((widget) => widget.widgetType === TREND_STRIP)) continue;
    if (stored.length >= MAX_DASHBOARD_WIDGETS) continue;
    const cut = cutOf(stored);
    for (const widget of stored) {
      if (widget.gridY >= cut) {
        moves.push({ id: widget.id, from: rectOf(widget), to: { ...rectOf(widget), gridY: widget.gridY + TREND_STRIP_WIDGET_ROWS } });
      }
    }
    inserts.push({
      tabKey: tab.key,
      widgetType: TREND_STRIP,
      title: stock.title,
      to: { gridX: 0, gridY: cut, gridW: DASHBOARD_GRID.columns, gridH: TREND_STRIP_WIDGET_ROWS },
      config:
        tab.assetGroupId === null
          ? { defaultRange: stock.defaultRange }
          : { tabKey: tab.key, defaultRange: stock.defaultRange },
    });
  }
  return { moves, inserts };
}
