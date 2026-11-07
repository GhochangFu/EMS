import { DASHBOARD_GRID } from "../contracts/dashboard-builder";
import { TREND_STRIP_WIDGET_ROWS } from "../contracts/trend-strip-widget";
// Type-only, and erased at emit: the `./ingest` precedent for an import back from the index.
import type { SectionTemplateWidget, StockDashboardTemplateDto } from "../index";

/**
 * `F4.319` (ADR 0113 decision 7, ruling Q8) — the pump-station standard site layout: one stock
 * template with `target: "site"` for a pump station, beside `smoc-standard`, which does not
 * change. Three tabs, each drawing one of the pump-station presets (ADR 0113 decision 1). The
 * tile set beyond the mimics is the plan's (`docs/plans/f4.319-pump-station-mimic-presets.md`
 * §5 task 3.1).
 *
 * - **Overview** (`domain: null`, `groupCode: "pump-station"`): the four site tiles of
 *   `smoc-standard`, the trend strip, the compact `pump_station_overview`, the alarm rail and the
 *   state legend. The Overview binds the domain-less `pump-station` group by its code (plan D4,
 *   `site-layout-planner.ts`), so its mimic names no `tabKey` and draws that group. A site with
 *   no `pump-station` group keeps the Overview and loses the mimic, reported in `droppedCards`.
 * - **Electrical**: the site load and the meter frequency, the trend strip,
 *   `pump_station_electrical`, the breaker table, the alarm rail and the asset table.
 * - `F4.332` (stockVersion 2): the Electrical tab ends with the read-time energy cost row —
 *   "Cost today", "Cost last 7 days", "Cost this month" and a 90-day "Daily energy cost" chart.
 * - **Environment**: the trend strip, `pump_station_environment`, the alarm rail and the asset
 *   table. No tiles: ruling Q7 names RTU health only, and the mimic shows each point on its node.
 *
 * Same grid literals as `smoc-standard` (the builder's 72 px grid). The tiles bind roles and
 * point keys, never assets (ADR 0049 decision 4). It lives in `packages/shared` for the reason
 * `smoc-standard.ts` gives: the API's stock catalog and the db seed both read it.
 */

const TILE_W = 3;
const TILE_H = 2;
const MIMIC_H = 7;
const LOWER_H = 5;
const LEGEND_H = 1;
const HALF_W = DASHBOARD_GRID.columns / 2;
const FULL_W = DASHBOARD_GRID.columns;
/** Every tab's body starts under the tile row and the trend strip (the `smoc-standard` v5 rule). */
const BODY_Y = TILE_H + TREND_STRIP_WIDGET_ROWS;

type Widget = SectionTemplateWidget;
type MimicConfig = Extract<Widget, { widgetType: "mimic" }>["config"];
type TileConfig = Extract<Widget, { widgetType: "value_tile" }>["config"];

function trendStrip(tabKey: string, scopeTabKey: string | null): Widget {
  return {
    key: `${tabKey}-trend-strip`,
    title: "Trends",
    gridX: 0,
    gridY: TILE_H,
    gridW: FULL_W,
    gridH: TREND_STRIP_WIDGET_ROWS,
    bindings: [],
    sources: [],
    widgetType: "trend_strip",
    config: scopeTabKey === null ? { defaultRange: "24h" } : { tabKey: scopeTabKey, defaultRange: "24h" },
  };
}

function mimic(key: string, gridY: number, config: MimicConfig): Widget {
  return {
    key,
    title: null,
    gridX: 0,
    gridY,
    gridW: FULL_W,
    gridH: MIMIC_H,
    bindings: [],
    sources: [],
    widgetType: "mimic",
    config,
  };
}

function alarmsRail(tabKey: string, gridY: number, gridW: number): Widget {
  return {
    key: `${tabKey}-alarms-rail`,
    title: "Active alarms",
    gridX: 0,
    gridY,
    gridW,
    gridH: LOWER_H,
    bindings: [],
    sources: [],
    widgetType: "active_alarms_rail",
    config: { rows: 8, showSummary: true },
  };
}

function assetsTable(tabKey: string, gridY: number): Widget {
  return {
    key: `${tabKey}-assets-table`,
    title: "Assets",
    gridX: HALF_W,
    gridY,
    gridW: HALF_W,
    gridH: LOWER_H,
    bindings: [],
    sources: [{ catalogKey: "assets.list", params: {}, sortOrder: 0 }],
    widgetType: "table",
    config: {},
  };
}

/** A catalog-source tile in slot `slot` (0 to 3) of a tab's top row. */
function sourceTile(key: string, title: string, slot: number, source: Widget["sources"][number], config: TileConfig): Widget {
  return {
    key,
    title,
    gridX: slot * TILE_W,
    gridY: 0,
    gridW: TILE_W,
    gridH: TILE_H,
    bindings: [],
    sources: [source],
    widgetType: "value_tile",
    config,
  };
}

const OVERVIEW_MIMIC_Y = BODY_Y;
const OVERVIEW_RAIL_Y = OVERVIEW_MIMIC_Y + MIMIC_H;

const OVERVIEW_WIDGETS: Widget[] = [
  sourceTile("overview-alarms-tile", "Active alarms", 0,
    { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }, { icon: "alert" }),
  sourceTile("overview-offline-tile", "Offline assets", 1,
    { catalogKey: "assets.offline.count", params: {}, sortOrder: 0 }, { icon: "offline" }),
  sourceTile("overview-load-tile", "Total load", 2,
    { catalogKey: "sustainability.total", params: { pointKey: "kw", aggregate: "sum" }, sortOrder: 0 },
    { icon: "bolt", unit: "kW" }),
  sourceTile("overview-health-tile", "Asset health", 3,
    { catalogKey: "assets.health.score", params: {}, sortOrder: 0 }, { icon: "gauge" }),
  trendStrip("overview", null),
  mimic("overview-station-mimic", OVERVIEW_MIMIC_Y, { source: "preset", preset: "pump_station_overview", compact: true }),
  alarmsRail("overview", OVERVIEW_RAIL_Y, FULL_W),
  {
    key: "overview-legend",
    title: null,
    gridX: 0,
    gridY: OVERVIEW_RAIL_Y + LOWER_H,
    gridW: FULL_W,
    gridH: LEGEND_H,
    bindings: [],
    sources: [],
    widgetType: "state_legend",
    config: {},
  },
];

const ELECTRICAL_LOWER_Y = BODY_Y + MIMIC_H + LOWER_H;
/** `F4.332` — the cost row sits under the alarm rail and the asset table. */
const COST_TILES_Y = ELECTRICAL_LOWER_Y + LOWER_H;

/** `F4.332` — a read-time energy cost tile for one period, in slot `slot` of the cost row. */
function costTile(key: string, title: string, slot: number, period: "today" | "last_7_days" | "this_month"): Widget {
  return {
    key,
    title,
    gridX: slot * TILE_W,
    gridY: COST_TILES_Y,
    gridW: TILE_W,
    gridH: TILE_H,
    bindings: [],
    sources: [{ catalogKey: "energy.cost.total", params: { period }, sortOrder: 0 }],
    widgetType: "value_tile",
    config: { icon: "bolt" },
  };
}

const ELECTRICAL_WIDGETS: Widget[] = [
  sourceTile("electrical-load-tile", "Total load", 0,
    { catalogKey: "sustainability.total", params: { pointKey: "kw", aggregate: "sum" }, sortOrder: 0 },
    { icon: "bolt", unit: "kW" }),
  // The meters hold `frequency_hz`, the `smoc-standard` frequency tile's binding.
  {
    key: "electrical-frequency-tile",
    title: "Frequency",
    gridX: TILE_W,
    gridY: 0,
    gridW: TILE_W,
    gridH: TILE_H,
    bindings: [{ assetRoleCode: "meter", pointKey: "frequency_hz", pointRole: "primary", sortOrder: 0 }],
    sources: [],
    widgetType: "value_tile",
    config: { unit: "Hz", decimals: 2 },
  },
  trendStrip("electrical", "electrical"),
  mimic("electrical-mimic", BODY_Y, { source: "preset", preset: "pump_station_electrical" }),
  {
    key: "electrical-breaker-table",
    title: "Breakers",
    gridX: 0,
    gridY: BODY_Y + MIMIC_H,
    gridW: FULL_W,
    gridH: LOWER_H,
    bindings: [],
    sources: [],
    widgetType: "breaker_table",
    config: {},
  },
  alarmsRail("electrical", ELECTRICAL_LOWER_Y, HALF_W),
  assetsTable("electrical", ELECTRICAL_LOWER_Y),
  // `F4.332` (ADR 0112 Amendment 3 item 6, stockVersion 2) — the read-time energy cost: three
  // tiles and the daily chart, under the tab's other widgets. 90 days read, so the viewer switch
  // offers 7 / 30 / 90 (default 30).
  costTile("electrical-cost-today-tile", "Cost today", 0, "today"),
  costTile("electrical-cost-week-tile", "Cost last 7 days", 1, "last_7_days"),
  costTile("electrical-cost-month-tile", "Cost this month", 2, "this_month"),
  {
    key: "electrical-daily-cost-chart",
    title: "Daily energy cost",
    gridX: 0,
    gridY: COST_TILES_Y + TILE_H,
    gridW: FULL_W,
    gridH: LOWER_H,
    bindings: [],
    sources: [{ catalogKey: "energy.cost_by_day", params: { days: 90 }, sortOrder: 0 }],
    widgetType: "chart",
    config: { series: "cost_by_day" },
  },
];

const ENV_LOWER_Y = BODY_Y + MIMIC_H;

const ENV_WIDGETS: Widget[] = [
  trendStrip("env", "env"),
  mimic("env-mimic", BODY_Y, { source: "preset", preset: "pump_station_environment" }),
  alarmsRail("env", ENV_LOWER_Y, HALF_W),
  assetsTable("env", ENV_LOWER_Y),
];

export const PUMP_STATION_STANDARD_SITE_TEMPLATE = {
  code: "pump-station-standard",
  name: "Pump station standard site layout",
  section: "site",
  target: "site",
  description:
    "A pump station: an Overview of the water path, the meters and RTU health, then an " +
    "electrical and an RTU-health tab, each with its own plant mimic.",
  // `F4.332` (ADR 0112 Amendment 3 item 6, ADR 0052 decision 7) — v2 adds the energy cost row to
  // the Electrical tab. Bumping touches no organization's row; the PHE layouts on AWS get the
  // widgets in place (owner ruling 4).
  stockVersion: 2,
  content: {
    widgets: [],
    tabs: [
      { key: "overview", label: "Overview", sortOrder: 0, domain: null, groupCode: "pump-station", widgets: OVERVIEW_WIDGETS },
      {
        key: "electrical",
        label: "Electrical",
        sortOrder: 1,
        domain: "electrical",
        groupCode: "electrical",
        mimicPreset: "pump_station_electrical",
        widgets: ELECTRICAL_WIDGETS,
      },
      {
        key: "env",
        label: "Environment",
        sortOrder: 2,
        domain: "environment",
        groupCode: "environment",
        mimicPreset: "pump_station_environment",
        widgets: ENV_WIDGETS,
      },
    ],
  },
} as const satisfies StockDashboardTemplateDto;
