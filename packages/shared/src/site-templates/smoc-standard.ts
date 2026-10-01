import { DASHBOARD_GRID } from "../contracts/dashboard-builder";
// Type-only, and erased at emit: the `./ingest` precedent for an import back from the index.
import type { SectionTemplateWidget, StockDashboardTemplateDto } from "../index";

/**
 * `F3.73` plan D8 — the SMOC standard site layout: one stock template with `target: "site"`,
 * copied onto a location as one tabbed dashboard (ADR 0087 decision 11, rulings Q3a and Q6b).
 *
 * **Why it lives in `packages/shared` and not beside the other stock entries.** Two readers need
 * it: `apps/api`'s stock catalog (the import route) and `packages/db`'s site-layout seed (the
 * seeded copies). The seed cannot import from `apps/api`. It sits behind the
 * `@bms/shared/site-templates` subpath, which the package index does not export, so the widget
 * configuration still never enters the web bundle — the rule `stock-catalog.ts`'s docblock
 * states for the whole catalog.
 *
 * **Tabs, in order**: `overview` (no group), `sld`, `ups`, `hvac`, `it`, `env`, `water`. The copy
 * action binds each domain tab to one asset group of the site (`site-layout-planner.ts`) and
 * omits a tab whose domain the site does not hold, dropping the Overview card that opens it.
 * `groupCode` names the seeded group a tab prefers when a site holds two of one domain (OQ1):
 * `electrical` and `ups-battery` share the electrical domain, `water` and `demo-water-plant`
 * the water domain.
 *
 * **The tiles bind roles and point keys, never assets** (ADR 0049 decision 4). Each key was
 * measured on the seeded estate (plan Task 4.0). A key with no seeded member is still valid
 * content — the instantiation report names the tile `unresolved` — and those are marked below.
 * The Q6b ruling lists fewer than four tiles for four of the tabs; the tabs carry that list and
 * are not padded to four with keys nobody ruled on. The `it` and `ups` tabs are the gap-fills
 * the ruling implies (OQ2); `it` binds the two IT keys the seeded racks and PDUs hold.
 */

/**
 * The canvas literals, read by every widget below rather than restated per widget. Stock
 * version 2 compacts each height to its content (v1: tile 4, strip 3, card 4, mimic 10, lower
 * 8). The seed moves a seeded copy still at the v1 rects to these
 * (`packages/db/src/site-layout-seed-upgrade.ts`), so a change here is a stock version bump.
 *
 * **The floor is the view canvas's 64 px row** (`VIEW_ROW_MIN_PX` in `dashboard-canvas.tsx`),
 * not the builder's 72 px one: `n` rows are `64n + 8(n - 1)` px. The legend keeps v1's 2 rows
 * (136 px): `WidgetFrame`'s chrome takes about 48.5 px, so 1 row would leave its pills about
 * 15 px. A value tile takes 2 rows (136 px): `KpiTile` with a hint and the ADR 0027 stale line
 * is about 132 px and is not clipped to its cell.
 */
const LEGEND_H = 2;
const TILE_W = 3;
const TILE_H = 2;
const STRIP_H = 2;
const CARD_W = 2;
const CARD_H = 3;
const MIMIC_H = 7;
const LOWER_H = 5;
const HALF_W = DASHBOARD_GRID.columns / 2;

type Widget = SectionTemplateWidget;

/**
 * A role-bound value tile, in slot `slot` (0 to 3) of a domain tab's top row.
 *
 * **The binding is an object literal at each call, never two positional strings.**
 * `tests/f3.38-stock-catalog-vocabulary.test.ts` scans this file as text for each role and
 * point-key property spelled with its quoted value; a positional argument would be checked
 * against no vocabulary at all.
 */
function roleTile(
  key: string,
  title: string,
  slot: number,
  binding: { readonly assetRoleCode: string; readonly pointKey: string },
  config: Extract<Widget, { widgetType: "value_tile" }>["config"],
): Widget {
  return {
    key,
    title,
    gridX: slot * TILE_W,
    gridY: 0,
    gridW: TILE_W,
    gridH: TILE_H,
    bindings: [{ ...binding, pointRole: "primary", sortOrder: 0 }],
    sources: [],
    widgetType: "value_tile",
    config,
  };
}

/**
 * The lower half every domain tab shares: the preset mimic when the tab has one, then the
 * group's alarm rail and its asset table side by side.
 */
function domainTabBody(
  tabKey: string,
  preset: Extract<Widget, { widgetType: "mimic" }>["config"] | null,
): Widget[] {
  const lowerY = TILE_H + (preset === null ? 0 : MIMIC_H);
  const mimic: Widget[] =
    preset === null
      ? []
      : [
          {
            key: `${tabKey}-mimic`,
            title: null,
            gridX: 0,
            gridY: TILE_H,
            gridW: DASHBOARD_GRID.columns,
            gridH: MIMIC_H,
            bindings: [],
            sources: [],
            widgetType: "mimic",
            config: preset,
          },
        ];
  return [
    ...mimic,
    {
      key: `${tabKey}-alarms-rail`,
      title: "Active alarms",
      gridX: 0,
      gridY: lowerY,
      gridW: HALF_W,
      gridH: LOWER_H,
      bindings: [],
      sources: [],
      widgetType: "active_alarms_rail",
      config: { rows: 8, showSummary: true },
    },
    {
      key: `${tabKey}-assets-table`,
      title: "Assets",
      gridX: HALF_W,
      gridY: lowerY,
      gridW: HALF_W,
      gridH: LOWER_H,
      bindings: [],
      sources: [{ catalogKey: "assets.list", params: {}, sortOrder: 0 }],
      widgetType: "table",
      config: {},
    },
  ];
}

/** One Overview card that opens tab `targetTabKey`, in slot `slot` of the card row. */
function moduleCard(targetTabKey: string, title: string, slot: number): Widget {
  return {
    key: `overview-${targetTabKey}-card`,
    title,
    gridX: slot * CARD_W,
    gridY: LEGEND_H + TILE_H + STRIP_H,
    gridW: CARD_W,
    gridH: CARD_H,
    bindings: [],
    sources: [],
    widgetType: "module_summary_card",
    config: { targetTabKey },
  };
}

/** The Overview's four site tiles — catalog sources over the site scope, no role (ruling Q6b). */
function siteTile(
  key: string,
  title: string,
  slot: number,
  source: Widget["sources"][number],
  config: Extract<Widget, { widgetType: "value_tile" }>["config"],
): Widget {
  return {
    key,
    title,
    gridX: slot * TILE_W,
    gridY: LEGEND_H,
    gridW: TILE_W,
    gridH: TILE_H,
    bindings: [],
    sources: [source],
    widgetType: "value_tile",
    config,
  };
}

const LOWER_OVERVIEW_Y = LEGEND_H + TILE_H + STRIP_H + CARD_H;

const OVERVIEW_WIDGETS: Widget[] = [
  {
    key: "overview-legend",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: DASHBOARD_GRID.columns,
    gridH: LEGEND_H,
    bindings: [],
    sources: [],
    widgetType: "state_legend",
    config: {},
  },
  siteTile("overview-alarms-tile", "Active alarms", 0,
    { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }, { icon: "alert" }),
  siteTile("overview-load-tile", "Total load", 1,
    { catalogKey: "sustainability.total", params: { pointKey: "kw", aggregate: "sum" }, sortOrder: 0 },
    { icon: "bolt", unit: "kW" }),
  siteTile("overview-health-tile", "Asset health", 2,
    { catalogKey: "assets.health.score", params: {}, sortOrder: 0 }, { icon: "gauge" }),
  siteTile("overview-offline-tile", "Offline assets", 3,
    { catalogKey: "assets.offline.count", params: {}, sortOrder: 0 }, { icon: "alert" }),
  {
    key: "overview-class-strip",
    title: null,
    gridX: 0,
    gridY: LEGEND_H + TILE_H,
    gridW: DASHBOARD_GRID.columns,
    gridH: STRIP_H,
    bindings: [],
    sources: [],
    widgetType: "asset_class_strip",
    config: {},
  },
  moduleCard("sld", "Electrical", 0),
  moduleCard("ups", "UPS & battery", 1),
  moduleCard("hvac", "HVAC", 2),
  moduleCard("it", "IT", 3),
  moduleCard("env", "Environment", 4),
  moduleCard("water", "Water", 5),
  {
    key: "overview-alarms-rail",
    title: "Active alarms",
    gridX: 0,
    gridY: LOWER_OVERVIEW_Y,
    gridW: HALF_W,
    gridH: LOWER_H,
    bindings: [],
    sources: [],
    widgetType: "active_alarms_rail",
    config: { rows: 8, showSummary: true },
  },
  {
    key: "overview-critical-systems",
    title: "Critical systems",
    gridX: HALF_W,
    gridY: LOWER_OVERVIEW_Y,
    gridW: HALF_W,
    gridH: LOWER_H,
    bindings: [],
    sources: [],
    widgetType: "critical_systems_list",
    config: {},
  },
];

// ---------------------------------------------------------------------------------------------
// The domain tabs' widgets. **Declared in this order on purpose, not in tab order**: f3.38
// refuses a `kw` binding followed within 400 characters by a percent unit (a kW value under a
// percent label), and the percent tiles below would sit that close to the SLD tab's `kw` tiles
// if the Electrical widgets came first. The tab order is the `tabs` array at the end of the file.
// (This comment spells neither literal: the scan reads comments as text too.)
// ---------------------------------------------------------------------------------------------

const UPS_WIDGETS: Widget[] = [
  // `load_pct` has no seeded member: no seeded UPS reports a load percentage, and `kw` under a
  // `%` label is the silent-wrong tile f3.38 refuses.
  roleTile("ups-load-tile", "UPS load", 0, { assetRoleCode: "ups", pointKey: "load_pct" }, { icon: "gauge", unit: "%" }),
  roleTile("ups-backup-tile", "Battery backup", 1, { assetRoleCode: "battery", pointKey: "backup_min" }, { unit: "min" }),
  ...domainTabBody("ups", null),
];

const IT_WIDGETS: Widget[] = [
  roleTile("it-rack-kw-tile", "Rack load", 0, { assetRoleCode: "it-rack", pointKey: "rack_kw" }, { icon: "bolt", unit: "kW" }),
  roleTile("it-pdu-util-tile", "PDU utilisation", 1, { assetRoleCode: "pdu", pointKey: "pdu_util_pct" }, { icon: "gauge", unit: "%" }),
  ...domainTabBody("it", { source: "preset", preset: "it_power_cooling" }),
];

const ENV_WIDGETS: Widget[] = [
  roleTile("env-temperature-tile", "Room temperature", 0, { assetRoleCode: "indoor-air", pointKey: "temperature_c" }, { unit: "°C", decimals: 1 }),
  // `humidity_pct` has no seeded member.
  roleTile("env-humidity-tile", "Room humidity", 1, { assetRoleCode: "indoor-air", pointKey: "humidity_pct" }, { unit: "%" }),
  ...domainTabBody("env", { source: "preset", preset: "environment_monitoring" }),
];

const WATER_WIDGETS: Widget[] = [
  // Inlet flow is the WTP's raw-water intake: no seeded asset holds an `inlet_flow_*` point.
  roleTile("water-inlet-flow-tile", "Inlet flow", 0, { assetRoleCode: "wtp", pointKey: "raw_water_flow_klh" }, { icon: "drop", unit: "KL/hr" }),
  // `treated_tank_level_pct` has no seeded member.
  roleTile("water-tank-level-tile", "Treated tank level", 1, { assetRoleCode: "treated-tank", pointKey: "treated_tank_level_pct" }, { icon: "drop", unit: "%" }),
  ...domainTabBody("water", { source: "preset", preset: "water_train" }),
];

const HVAC_WIDGETS: Widget[] = [
  roleTile("hvac-supply-air-tile", "Supply air", 0, { assetRoleCode: "crac", pointKey: "supply_air_temp_c" }, { unit: "°C", decimals: 1 }),
  roleTile("hvac-return-air-tile", "Return air", 1, { assetRoleCode: "crac", pointKey: "return_air_temp_c" }, { unit: "°C", decimals: 1 }),
  // `cooling_kw` has no seeded member.
  roleTile("hvac-cooling-tile", "Cooling load", 2, { assetRoleCode: "crac", pointKey: "cooling_kw" }, { unit: "kW" }),
  ...domainTabBody("hvac", { source: "preset", preset: "hvac_chiller_plant" }),
];

const SLD_WIDGETS: Widget[] = [
  // The incomer frequency binds `meter`, the one role whose seeded members hold `frequency_hz`
  // (the pump-station meters); no seeded incomer or panel reports a frequency.
  roleTile("sld-incomer-kw-tile", "Incomer load", 0, { assetRoleCode: "incoming-supply", pointKey: "kw" }, { icon: "bolt", unit: "kW" }),
  roleTile("sld-incomer-pf-tile", "Incomer power factor", 1, { assetRoleCode: "incoming-supply", pointKey: "pf" }, { decimals: 2 }),
  roleTile("sld-frequency-tile", "Frequency", 2, { assetRoleCode: "meter", pointKey: "frequency_hz" }, { unit: "Hz", decimals: 2 }),
  roleTile("sld-main-bus-kw-tile", "Main bus load", 3, { assetRoleCode: "lt-panel", pointKey: "kw" }, { icon: "bolt", unit: "kW" }),
  ...domainTabBody("sld", { source: "preset", preset: "electrical_distribution" }),
];

export const SMOC_STANDARD_SITE_TEMPLATE = {
  code: "smoc-standard",
  name: "SMOC standard site layout",
  section: "site",
  target: "site",
  description:
    "One tab per domain present at the site — electrical, UPS & battery, HVAC, IT, environment, " +
    "water — behind an Overview of site metrics, module cards and critical systems.",
  stockVersion: 2,
  content: {
    widgets: [],
    tabs: [
      { key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: OVERVIEW_WIDGETS },
      {
        key: "sld",
        label: "Electrical",
        sortOrder: 1,
        domain: "electrical",
        groupCode: "electrical",
        mimicPreset: "electrical_distribution",
        widgets: SLD_WIDGETS,
      },
      {
        key: "ups",
        label: "UPS & battery",
        sortOrder: 2,
        domain: "electrical",
        groupCode: "ups-battery",
        widgets: UPS_WIDGETS,
      },
      {
        key: "hvac",
        label: "HVAC",
        sortOrder: 3,
        domain: "hvac",
        mimicPreset: "hvac_chiller_plant",
        widgets: HVAC_WIDGETS,
      },
      {
        key: "it",
        label: "IT",
        sortOrder: 4,
        domain: "it",
        groupCode: "it-rack",
        mimicPreset: "it_power_cooling",
        widgets: IT_WIDGETS,
      },
      {
        key: "env",
        label: "Environment",
        sortOrder: 5,
        domain: "environment",
        mimicPreset: "environment_monitoring",
        widgets: ENV_WIDGETS,
      },
      {
        key: "water",
        label: "Water",
        sortOrder: 6,
        domain: "water",
        groupCode: "water",
        mimicPreset: "water_train",
        widgets: WATER_WIDGETS,
      },
    ],
  },
} as const satisfies StockDashboardTemplateDto;
