import { DASHBOARD_GRID } from "../contracts/dashboard-builder";
// Type-only, and erased at emit: the `./ingest` precedent for an import back from the index.
import type { SectionTemplateWidget, StockDashboardTemplateDto } from "../index";

/**
 * `F4.317` task 3.3 — the stock organization strip, `organization-standard` (ADR 0112 decisions
 * 3 and 6, Amendment 1). One `target: "organization"` stock template: a flat list of fourteen
 * value tiles and the daily energy cost chart (Amendments 3 and 4), copied onto one
 * organization-wide dashboard by "Make organization layout".
 *
 * **It is also the fail-safe.** An organization with no `bms.organization_control_room_views`
 * row draws this content, resolved through the catalog at organization scope (decision 3), so
 * every organization has the strip with no admin action. It lives beside `smoc-standard.ts`
 * for that file's reason: its readers are the API (the stock catalog, and the organization
 * view's fail-safe) and `packages/db` (the seed copies of ruling Q3), which cannot import from
 * `apps/api`. It sits behind the `@bms/shared/site-templates` subpath, which the web bundle
 * never imports.
 *
 * **Every tile binds catalog sources and no role**: the strip is the whole organization, with no
 * asset group to resolve a role against, and each source resolves over the caller's readable
 * assets of that organization (decision 5).
 *
 * - **Tile 3 binds two keys** (ruling Q1b): `alarms.active.count` is the primary (sortOrder 0)
 *   and `alarms.critical.count` the critical note (sortOrder 1). Two keys, because
 *   `UNIQUE (widget_id, catalog_key)` forbids one key twice on a widget.
 * - **"vs yesterday"** (`compareToPrevious`) is on Total load and Open alarms only (ruling 6).
 * - **The cost tiles type no unit**: the cost point keys carry unit `""` on purpose (ADR 0070
 *   decision 8). `sustainability.total` answers the organization's `currency`; `energy.cost.total`
 *   answers the scoped assets' tariff currency (`null` with `currency_mixed` when they differ).
 * - **The energy cost tiles read the read-time cost** (`energy.cost.total`, ADR 0112 Amendment 4,
 *   `F4.338`): each hour priced at that hour's rate over every meter, so "Energy cost today"
 *   equals the chart's last bar. The water cost tiles still read the stored `water_cost_*` points
 *   (no dated water rate exists yet).
 * - **Water today binds `{ kl_today, sum, balanceRole: "intake" }`** (ADR 0112 Amendment 2), as
 *   the sustainability-overview stock tile does: without the role the sum counts every water
 *   stage's inlet and overcounts a multi-stage plant.
 *
 * **The `pointKey` of each source is an object literal at its call**, never a positional string:
 * `tests/f3.38-stock-catalog-vocabulary.test.ts` scans this file as text for each spelled code.
 */

type Widget = SectionTemplateWidget;
type TileConfig = Extract<Widget, { widgetType: "value_tile" }>["config"];

/** Four tiles a row, the SMOC tile size (`smoc-standard.ts`: 3 columns, 2 builder rows). */
const PER_ROW = 4;
const TILE_W = DASHBOARD_GRID.columns / PER_ROW;
const TILE_H = 2;
/** `F4.332` — the daily cost chart's height in builder rows, under the tiles. */
const COST_CHART_H = 5;
/** `F4.338` — the number of tiles above the chart (ADR 0112 Amendment 4). */
const TILE_COUNT = 14;

/** The tile in grid slot `slot` (0 to 13), packed four to a row from the top-left. */
function tile(key: string, title: string, slot: number, sources: Widget["sources"], config: TileConfig): Widget {
  return {
    key,
    title,
    gridX: (slot % PER_ROW) * TILE_W,
    gridY: Math.floor(slot / PER_ROW) * TILE_H,
    gridW: TILE_W,
    gridH: TILE_H,
    bindings: [],
    sources,
    widgetType: "value_tile",
    config,
  };
}

/** ADR 0112 decision 6, in its order. Row 1 is the estate's four tiles, scoped to the organization. */
const WIDGETS: Widget[] = [
  tile("total-load-tile", "Total load", 0,
    [{ catalogKey: "sustainability.total", params: { pointKey: "kw", aggregate: "sum" }, sortOrder: 0 }],
    { icon: "bolt", unit: "kW", compareToPrevious: true }),
  tile("sites-live-tile", "Sites live", 1,
    [{ catalogKey: "sites.live.count", params: {}, sortOrder: 0 }], {}),
  tile("open-alarms-tile", "Open alarms", 2,
    [
      { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 },
      { catalogKey: "alarms.critical.count", params: {}, sortOrder: 1 },
    ],
    { icon: "alert", compareToPrevious: true }),
  tile("pue-tile", "PUE", 3,
    [{ catalogKey: "pue.ratio", params: {}, sortOrder: 0 }], { icon: "gauge", decimals: 2 }),
  tile("energy-today-tile", "Energy today", 4,
    [{ catalogKey: "sustainability.total", params: { pointKey: "kwh_today", aggregate: "sum" }, sortOrder: 0 }],
    { icon: "bolt", unit: "kWh" }),
  tile("water-today-tile", "Water today", 5,
    [{ catalogKey: "sustainability.total", params: { pointKey: "kl_today", aggregate: "sum", balanceRole: "intake" }, sortOrder: 0 }],
    { icon: "drop", unit: "KL" }),
  tile("assets-offline-tile", "Assets offline", 6,
    [{ catalogKey: "assets.offline.count", params: {}, sortOrder: 0 }], { icon: "offline" }),
  tile("asset-health-tile", "Asset health", 7,
    [{ catalogKey: "assets.health.score", params: {}, sortOrder: 0 }], { icon: "gauge" }),
  tile("open-work-orders-tile", "Open work orders", 8,
    [{ catalogKey: "workorders.open.count", params: {}, sortOrder: 0 }], { icon: "clipboard" }),
  // `F4.338` / ADR 0112 Amendment 4 (stockVersion 3) — the read-time cost, as "Cost this month".
  tile("energy-cost-today-tile", "Energy cost today", 9,
    [{ catalogKey: "energy.cost.total", params: { period: "today" }, sortOrder: 0 }], { icon: "bolt" }),
  tile("water-cost-today-tile", "Water cost today", 10,
    [{ catalogKey: "sustainability.total", params: { pointKey: "water_cost_today", aggregate: "sum" }, sortOrder: 0 }], {}),
  tile("water-cost-month-tile", "Water cost this month", 11,
    [{ catalogKey: "sustainability.total", params: { pointKey: "water_cost_this_month", aggregate: "sum" }, sortOrder: 0 }], {}),
  tile("availability-tile", "Availability (24 h)", 12,
    [{ catalogKey: "sustainability.total", params: { pointKey: "availability_pct_24h", aggregate: "avg" }, sortOrder: 0 }],
    { icon: "gauge", unit: "%", decimals: 1 }),
  // `F4.332` / ADR 0112 Amendment 3 item 5 (stockVersion 2) — the read-time cost: each hour priced
  // at the rate in force that hour, so a past day keeps its price when the rate changes.
  tile("cost-this-month-tile", "Cost this month", TILE_COUNT - 1,
    [{ catalogKey: "energy.cost.total", params: { period: "this_month" }, sortOrder: 0 }], { icon: "bolt" }),
  {
    key: "daily-energy-cost-chart",
    title: "Daily energy cost (30 days)",
    gridX: 0,
    gridY: Math.ceil(TILE_COUNT / PER_ROW) * TILE_H,
    gridW: DASHBOARD_GRID.columns,
    gridH: COST_CHART_H,
    bindings: [],
    sources: [{ catalogKey: "energy.cost_by_day", params: { days: 30 }, sortOrder: 0 }],
    widgetType: "chart",
    config: { series: "cost_by_day" },
  },
];

export const ORGANIZATION_STANDARD_TEMPLATE = {
  code: "organization-standard",
  name: "Organization standard",
  section: "organization",
  target: "organization",
  description:
    "The organization Control Room KPI strip: the estate's four tiles scoped to the " +
    "organization, then its energy, water, asset, work-order, cost and availability tiles, and " +
    "the daily energy cost of the last 30 days.",
  // `F4.332` (ADR 0112 Amendment 3, ADR 0052 decision 7) — v2 adds "Cost this month" and the
  // daily energy cost chart. `F4.338` (Amendment 4) — v3 removes the stored "Energy cost this
  // month" tile and reads "Energy cost today" at read time. Bumping touches no organization's
  // row: an organization takes the release by importing it; the live PHE strip is edited in place.
  stockVersion: 3,
  content: { widgets: WIDGETS, tabs: [] },
} as const satisfies StockDashboardTemplateDto;
