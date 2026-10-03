import type { SectionTemplateContent, SectionTemplateWidget } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

/**
 * The SMOC standard site layout's past stock versions, frozen (`F3.77` plan D5). The live stock
 * entry (`packages/shared/src/site-templates/smoc-standard.ts`) only ever holds the current
 * version, so the seed's upgrade chain (`site-layout-seed-upgrade.ts`) reads every older shape it
 * still has to recognise from here:
 *
 * - **v1** (`F3.73`): every widget at its first rect ({@link SMOC_STANDARD_V1_RECTS}).
 * - **v2** (`F3.73` compaction): the domain tabs as they still are, and the Overview of 14
 *   widgets with module cards ({@link OVERVIEW_V2_WIDGETS}).
 * - **v3** (`F3.77`, ADR 0087 Amendment 3): the Overview has no card
 *   ({@link OVERVIEW_V3_WIDGETS}), and the `sld` tab draws `electrical_distribution` with no
 *   breaker table ({@link SLD_V3_WIDGETS}). `F3.74` froze it here when v4 became the live entry.
 * - **v4** (`F3.74`, ADR 0088 Amendment 2) is the live entry: a compact `lv_single_line` beside
 *   the class strip on the Overview, and `lv_single_line` with a breaker table on the `sld` tab.
 *
 * **Adding a version** (v5 is next): freeze the shape that is about to stop being current — its
 * changed tabs' widgets and a `smocStandardV4Content()` built the way
 * {@link smocStandardV3Content} is — before the stock entry changes, then point the chain's next
 * step at it. Nothing in this file is ever edited after its version ships: a copy the seed wrote
 * at that version still holds exactly these values.
 */

export type GridRect = {
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
};

/** The Overview's tab key, in every stock version. */
export const OVERVIEW_TAB_KEY = "overview";

/** The electrical tab's key, in every stock version. */
export const SLD_TAB_KEY = "sld";

/** How a copy's widget is known: its tab key, widget type and title. */
export function siteWidgetIdentity(tabKey: string, widgetType: string, title: string | null): string {
  return `${tabKey}|${widgetType}|${title ?? ""}`;
}

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

/**
 * A JSON value with every object's keys sorted, so two values compare equal whatever their key
 * order: Postgres `jsonb` stores an object's keys in its own order, not the one written.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

// ── v1 ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stock version 1's rects, `[x, y, w, h]`. Read from the copies the v1 seed wrote (every tab
 * but `it`, which no seeded site holds; its rects follow the same v1 rule as the other mimic
 * tabs). v1 held the same widgets as v2.
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

/** The v2 content with every widget at its v1 rect — what the v1 seed stored. */
export function smocStandardV1Content(): SectionTemplateContent {
  const content = smocStandardV2Content();
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

// ── v2 ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The sha256 of {@link canonicalJson} of stock v2's tabs other than the Overview, taken from the
 * v2 source (`smoc-standard.ts` at `b21eadad`). {@link smocStandardV2Content} reuses the live
 * domain tabs, which is right only while they still hash to this; the history spec holds it.
 */
export const SMOC_STANDARD_V2_DOMAIN_TABS_SHA256 = "d670d74709844e4b63316d7a719508aa93b1257351c34b94be8a01e4ff379826";

/** The v2 Overview's catalog-sourced site tile. */
function v2SiteTile(
  key: string,
  title: string,
  gridX: number,
  source: SectionTemplateWidget["sources"][number],
  config: Extract<SectionTemplateWidget, { widgetType: "value_tile" }>["config"],
): SectionTemplateWidget {
  return { key, title, gridX, gridY: 2, gridW: 3, gridH: 2, bindings: [], sources: [source], widgetType: "value_tile", config };
}

/** One v2 Overview card that opens tab `targetTabKey`. */
function v2Card(targetTabKey: string, title: string, gridX: number): SectionTemplateWidget {
  return {
    key: `overview-${targetTabKey}-card`,
    title,
    gridX,
    gridY: 6,
    gridW: 2,
    gridH: 3,
    bindings: [],
    sources: [],
    widgetType: "module_summary_card",
    config: { targetTabKey },
  };
}

/**
 * Stock v2's Overview, in its template order (the order `packAfterRemoval` packs in): the legend
 * 12×2, the four tiles (the Offline tile with the `alert` icon), the class strip, six module
 * cards 2×3, the alarm rail and the critical systems list 6×5 — 14 rows.
 */
export const OVERVIEW_V2_WIDGETS: readonly SectionTemplateWidget[] = [
  {
    key: "overview-legend",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 12,
    gridH: 2,
    bindings: [],
    sources: [],
    widgetType: "state_legend",
    config: {},
  },
  v2SiteTile("overview-alarms-tile", "Active alarms", 0,
    { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }, { icon: "alert" }),
  v2SiteTile("overview-load-tile", "Total load", 3,
    { catalogKey: "sustainability.total", params: { pointKey: "kw", aggregate: "sum" }, sortOrder: 0 },
    { icon: "bolt", unit: "kW" }),
  v2SiteTile("overview-health-tile", "Asset health", 6,
    { catalogKey: "assets.health.score", params: {}, sortOrder: 0 }, { icon: "gauge" }),
  v2SiteTile("overview-offline-tile", "Offline assets", 9,
    { catalogKey: "assets.offline.count", params: {}, sortOrder: 0 }, { icon: "alert" }),
  {
    key: "overview-class-strip",
    title: null,
    gridX: 0,
    gridY: 4,
    gridW: 12,
    gridH: 2,
    bindings: [],
    sources: [],
    widgetType: "asset_class_strip",
    config: {},
  },
  v2Card("sld", "Electrical", 0),
  v2Card("ups", "UPS & battery", 2),
  v2Card("hvac", "HVAC", 4),
  v2Card("it", "IT", 6),
  v2Card("env", "Environment", 8),
  v2Card("water", "Water", 10),
  {
    key: "overview-alarms-rail",
    title: "Active alarms",
    gridX: 0,
    gridY: 9,
    gridW: 6,
    gridH: 5,
    bindings: [],
    sources: [],
    widgetType: "active_alarms_rail",
    config: { rows: 8, showSummary: true },
  },
  {
    key: "overview-critical-systems",
    title: "Critical systems",
    gridX: 6,
    gridY: 9,
    gridW: 6,
    gridH: 5,
    bindings: [],
    sources: [],
    widgetType: "critical_systems_list",
    config: {},
  },
];

/**
 * Stock v2's content: the frozen v3 content with the Overview's widgets replaced by the v2 ones.
 * Built from {@link smocStandardV3Content}, not from the live entry: the v2 domain tabs are the v3
 * ones (hashed by {@link SMOC_STANDARD_V2_DOMAIN_TABS_SHA256}), and the live `sld` tab is v4's.
 */
export function smocStandardV2Content(): SectionTemplateContent {
  const content = smocStandardV3Content();
  return {
    ...content,
    tabs: content.tabs.map((tab) => (tab.key === OVERVIEW_TAB_KEY ? { ...tab, widgets: [...OVERVIEW_V2_WIDGETS] } : tab)),
  };
}

// ── v3 ──────────────────────────────────────────────────────────────────────────────────────

/** A v3 Overview value tile: slot `slot` of the top row, fed by one catalog source. */
function v3SiteTile(
  key: string,
  title: string,
  slot: number,
  source: SectionTemplateWidget["sources"][number],
  config: Extract<SectionTemplateWidget, { widgetType: "value_tile" }>["config"],
): SectionTemplateWidget {
  return { key, title, gridX: slot * 3, gridY: 0, gridW: 3, gridH: 2, bindings: [], sources: [source], widgetType: "value_tile", config };
}

/**
 * Stock v3's Overview (`F3.77`), in its template order: the four tiles (the Offline tile with the
 * `offline` icon), the 8-wide alarm rail and the 4-wide systems list at y2, the full-width class
 * strip at y9 and the 1-row legend at y11 — 12 rows, no module card.
 */
export const OVERVIEW_V3_WIDGETS: readonly SectionTemplateWidget[] = [
  v3SiteTile("overview-alarms-tile", "Active alarms", 0,
    { catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }, { icon: "alert" }),
  v3SiteTile("overview-offline-tile", "Offline assets", 1,
    { catalogKey: "assets.offline.count", params: {}, sortOrder: 0 }, { icon: "offline" }),
  v3SiteTile("overview-load-tile", "Total load", 2,
    { catalogKey: "sustainability.total", params: { pointKey: "kw", aggregate: "sum" }, sortOrder: 0 },
    { icon: "bolt", unit: "kW" }),
  v3SiteTile("overview-health-tile", "Asset health", 3,
    { catalogKey: "assets.health.score", params: {}, sortOrder: 0 }, { icon: "gauge" }),
  {
    key: "overview-alarms-rail",
    title: "Active alarms",
    gridX: 0,
    gridY: 2,
    gridW: 8,
    gridH: 7,
    bindings: [],
    sources: [],
    widgetType: "active_alarms_rail",
    config: { rows: 8, showSummary: true },
  },
  {
    key: "overview-critical-systems",
    title: "Critical systems",
    gridX: 8,
    gridY: 2,
    gridW: 4,
    gridH: 7,
    bindings: [],
    sources: [],
    widgetType: "critical_systems_list",
    config: {},
  },
  {
    key: "overview-class-strip",
    title: null,
    gridX: 0,
    gridY: 9,
    gridW: 12,
    gridH: 2,
    bindings: [],
    sources: [],
    widgetType: "asset_class_strip",
    config: {},
  },
  {
    key: "overview-legend",
    title: null,
    gridX: 0,
    gridY: 11,
    gridW: 12,
    gridH: 1,
    bindings: [],
    sources: [],
    widgetType: "state_legend",
    config: {},
  },
];

/** A v3 `sld` role tile: slot `slot` of the top row, bound to a role and point key. */
function v3SldTile(
  key: string,
  title: string,
  slot: number,
  binding: { readonly assetRoleCode: string; readonly pointKey: string },
  config: Extract<SectionTemplateWidget, { widgetType: "value_tile" }>["config"],
): SectionTemplateWidget {
  return {
    key,
    title,
    gridX: slot * 3,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    bindings: [{ ...binding, pointRole: "primary", sortOrder: 0 }],
    sources: [],
    widgetType: "value_tile",
    config,
  };
}

/**
 * Stock v3's `sld` tab widgets (`electrical_distribution`, no breaker table): the four role
 * tiles, the full-width mimic at y2, then the alarm rail and the assets table at y9 — 14 rows.
 */
export const SLD_V3_WIDGETS: readonly SectionTemplateWidget[] = [
  v3SldTile("sld-incomer-kw-tile", "Incomer load", 0, { assetRoleCode: "incoming-supply", pointKey: "kw" }, { icon: "bolt", unit: "kW" }),
  v3SldTile("sld-incomer-pf-tile", "Incomer power factor", 1, { assetRoleCode: "incoming-supply", pointKey: "pf" }, { decimals: 2 }),
  v3SldTile("sld-frequency-tile", "Frequency", 2, { assetRoleCode: "meter", pointKey: "frequency_hz" }, { unit: "Hz", decimals: 2 }),
  v3SldTile("sld-main-bus-kw-tile", "Main bus load", 3, { assetRoleCode: "lt-panel", pointKey: "kw" }, { icon: "bolt", unit: "kW" }),
  {
    key: "sld-mimic",
    title: null,
    gridX: 0,
    gridY: 2,
    gridW: 12,
    gridH: 7,
    bindings: [],
    sources: [],
    widgetType: "mimic",
    config: { source: "preset", preset: "electrical_distribution" },
  },
  {
    key: "sld-alarms-rail",
    title: "Active alarms",
    gridX: 0,
    gridY: 9,
    gridW: 6,
    gridH: 5,
    bindings: [],
    sources: [],
    widgetType: "active_alarms_rail",
    config: { rows: 8, showSummary: true },
  },
  {
    key: "sld-assets-table",
    title: "Assets",
    gridX: 6,
    gridY: 9,
    gridW: 6,
    gridH: 5,
    bindings: [],
    sources: [{ catalogKey: "assets.list", params: {}, sortOrder: 0 }],
    widgetType: "table",
    config: {},
  },
];

/**
 * Stock v3's content: the live (v4) tabs with the Overview replaced by {@link OVERVIEW_V3_WIDGETS}
 * and the `sld` tab by its v3 shape. Every other tab is unchanged in v4.
 */
export function smocStandardV3Content(): SectionTemplateContent {
  const content = SMOC_STANDARD_SITE_TEMPLATE.content as SectionTemplateContent;
  return {
    ...content,
    tabs: content.tabs.map((tab) => {
      if (tab.key === OVERVIEW_TAB_KEY) return { ...tab, widgets: [...OVERVIEW_V3_WIDGETS] };
      if (tab.key === SLD_TAB_KEY) return { ...tab, mimicPreset: "electrical_distribution", widgets: [...SLD_V3_WIDGETS] };
      return tab;
    }),
  };
}

/** Stock version 2's rects by {@link siteWidgetIdentity}. */
export const SMOC_STANDARD_V2_RECTS: ReadonlyMap<string, GridRect> = siteTemplateRects(smocStandardV2Content());
