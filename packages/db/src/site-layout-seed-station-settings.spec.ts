import type pg from "pg";
import { expect } from "vitest";

import { PUMP_STATION_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import { loadPheCatalog } from "./phe-pilot-seed";
import { pheSiteLayoutStations } from "./site-layout-seed";
import {
  considersCopy,
  copyStationWidgetSettings,
  pairAsMadeConfigs,
  planStationSettingsCopy,
  type StationSettingsAsMade,
  type StationSettingsWidget,
} from "./site-layout-seed-station-settings";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.388` (ADR 0139 Amendment 1; plan D3, Task 1) — the pure half of the step that gives a split
 * site's copy its station's `mimic` and `trend_strip` settings. The fixture is the demo host's
 * Lotapata station and site copies, measured read-only on 2026-11-19.
 */

type Rect = readonly [number, number, number, number];

function widget(id: string, tabKey: string, widgetType: string, rect: Rect, config: unknown): StationSettingsWidget {
  const [gridX, gridY, gridW, gridH] = rect;
  return { id, tabKey, widgetType, gridX, gridY, gridW, gridH, config };
}

const MIMIC_RECTS: Readonly<Record<string, Rect>> = {
  overview: [6, 3, 6, 6],
  electrical: [6, 2, 6, 6],
  env: [6, 2, 6, 6],
};

const STRIP_RECTS: Readonly<Record<string, Rect>> = {
  overview: [0, 3, 6, 6],
  electrical: [0, 2, 6, 6],
  env: [0, 2, 6, 4],
};

const PRESETS: Readonly<Record<string, string>> = {
  overview: "pump_station_overview",
  electrical: "pump_station_electrical",
  env: "pump_station_environment",
};

const TABS = ["overview", "electrical", "env"] as const;
/** The site copy's tab keys: all three, as the demo host's copies hold. */
const ALL_TABS: ReadonlySet<string> = new Set(TABS);

function stationMimicConfig(tab: string): Record<string, unknown> {
  return tab === "overview"
    ? { preset: PRESETS[tab], source: "preset", compact: true, glyphSet: "iso" }
    : { preset: PRESETS[tab], source: "preset", glyphSet: "iso" };
}

function siteMimicConfig(tab: string): Record<string, unknown> {
  return tab === "overview"
    ? { preset: PRESETS[tab], source: "preset", compact: true }
    : { preset: PRESETS[tab], source: "preset" };
}

function stationStripConfig(tab: string): Record<string, unknown> {
  return {
    colors: {
      "electrical:kw": "series-1",
      "electrical:pf": "series-3",
      "electrical:current_a": "series-6",
      "electrical:kwh_total": "series-2",
      "electrical:frequency_hz": "series-4",
      "electrical:voltage_l1_v": "series-7",
    },
    points: [
      "electrical:kw",
      "electrical:kwh_total",
      "electrical:pf",
      "environment:humidity_pct",
      "environment:temperature_c",
      "electrical:frequency_hz",
      "electrical:current_a",
      "electrical:voltage_l1_v",
    ],
    styles: {
      "electrical:kwh_total": "area",
      "electrical:frequency_hz": "area",
      "electrical:voltage_l1_v": "bar",
    },
    tabKey: tab,
    segments: ["electrical", "environment"],
    defaultRange: "24h",
  };
}

function siteStripConfig(tab: string): Record<string, unknown> {
  return tab === "overview" ? { defaultRange: "24h" } : { tabKey: tab, defaultRange: "24h" };
}

function stationWidgets(): StationSettingsWidget[] {
  return TABS.flatMap((tab) => [
    widget(`station-mimic-${tab}`, tab, "mimic", MIMIC_RECTS[tab]!, stationMimicConfig(tab)),
    widget(`station-strip-${tab}`, tab, "trend_strip", STRIP_RECTS[tab]!, stationStripConfig(tab)),
  ]);
}

/** The site's copy as the seed made it, and the as-made map keyed by widget id. */
function siteFixture(): { widgets: StationSettingsWidget[]; asMade: Map<string, unknown> } {
  const widgets = TABS.flatMap((tab) => [
    widget(`site-mimic-${tab}`, tab, "mimic", MIMIC_RECTS[tab]!, siteMimicConfig(tab)),
    widget(`site-strip-${tab}`, tab, "trend_strip", STRIP_RECTS[tab]!, siteStripConfig(tab)),
  ]);
  const asMade = new Map<string, unknown>(widgets.map((item) => [item.id, structuredClone(item.config)]));
  return { widgets, asMade };
}

function replaceWidget(
  widgets: readonly StationSettingsWidget[],
  id: string,
  change: Partial<StationSettingsWidget>,
): StationSettingsWidget[] {
  return widgets.map((item) => (item.id === id ? { ...item, ...change } : item));
}

const asMadeOf = (map: Map<string, unknown>): StationSettingsAsMade => map;

/** S1 — the demo-host fixture: six updates, each from the station widget of its own tab. */
export function assertTheAwsFixtureCopiesSixWidgets(): void {
  const site = siteFixture();
  const plan = planStationSettingsCopy(site.widgets, stationWidgets(), asMadeOf(site.asMade), ALL_TABS);
  expect(plan.kept).toEqual([]);
  expect(plan.unchanged).toEqual([]);
  expect(plan.updates).toHaveLength(6);
  for (const tab of TABS) {
    expect(plan.updates).toContainEqual({
      widgetId: `site-mimic-${tab}`,
      from: siteMimicConfig(tab),
      to: stationMimicConfig(tab),
    });
    expect(plan.updates).toContainEqual({
      widgetId: `site-strip-${tab}`,
      from: siteStripConfig(tab),
      to: stationStripConfig(tab),
    });
  }
  const stripTabs = plan.updates
    .filter((update) => update.widgetId.startsWith("site-strip-"))
    .map((update) => [update.widgetId, (update.to as { tabKey?: string }).tabKey]);
  expect(stripTabs).toEqual([
    ["site-strip-overview", "overview"],
    ["site-strip-electrical", "electrical"],
    ["site-strip-env", "env"],
  ]);
}

/** S2 — a site widget an administrator edited keeps its config; the other five are copied. */
export function assertAnEditedSiteWidgetIsKept(): void {
  const site = siteFixture();
  const edited = replaceWidget(site.widgets, "site-mimic-electrical", {
    config: { preset: "pump_station_electrical", source: "preset", motion: false },
  });
  const plan = planStationSettingsCopy(edited, stationWidgets(), asMadeOf(site.asMade), ALL_TABS);
  expect(plan.updates.map((update) => update.widgetId).sort()).toEqual(
    ["site-mimic-env", "site-mimic-overview", "site-strip-electrical", "site-strip-env", "site-strip-overview"],
  );
  expect(plan.kept).toEqual([{ widgetId: "site-mimic-electrical", reason: "edited" }]);
}

/** S3 — only `mimic` and `trend_strip` are copied: a station `value_tile` at the same rect is not. */
export function assertOnlyMimicAndTrendStripAreCopied(): void {
  const site = siteFixture();
  const tileRect: Rect = [0, 0, 3, 2];
  const siteTile = widget("site-tile", "overview", "value_tile", tileRect, { unit: "kW" });
  const stationTile = widget("station-tile", "overview", "value_tile", tileRect, { unit: "kW", decimals: 2 });
  site.asMade.set(siteTile.id, structuredClone(siteTile.config));
  const plan = planStationSettingsCopy([...site.widgets, siteTile], [...stationWidgets(), stationTile], asMadeOf(site.asMade), ALL_TABS);
  expect(plan.updates).toHaveLength(6);
  expect(plan.updates.map((update) => update.widgetId)).not.toContain("site-tile");
  expect(plan.kept).toEqual([]);
  expect(plan.unchanged).toEqual([]);
}

/** S4 — no station widget at the rect, or two: the site widget keeps its config, the reason named. */
export function assertNoMatchAndTwoMatchesAreKept(): void {
  const site = siteFixture();
  const stations = stationWidgets()
    .filter((item) => item.id !== "station-strip-env")
    .concat(widget("station-mimic-overview-twin", "overview", "mimic", MIMIC_RECTS.overview!, stationMimicConfig("overview")));
  const plan = planStationSettingsCopy(site.widgets, stations, asMadeOf(site.asMade), ALL_TABS);
  expect(plan.kept).toEqual([
    { widgetId: "site-mimic-overview", reason: "several_station_matches" },
    { widgetId: "site-strip-env", reason: "no_station_match" },
  ]);
  expect(plan.updates).toHaveLength(4);

  const moved = replaceWidget(stationWidgets(), "station-strip-env", { gridH: 6 });
  expect(planStationSettingsCopy(site.widgets, moved, asMadeOf(site.asMade), ALL_TABS).kept).toEqual([
    { widgetId: "site-strip-env", reason: "no_station_match" },
  ]);

  const otherType = replaceWidget(stationWidgets(), "station-mimic-env", { widgetType: "trend_strip" });
  expect(planStationSettingsCopy(site.widgets, otherType, asMadeOf(site.asMade), ALL_TABS).kept).toContainEqual({
    widgetId: "site-mimic-env",
    reason: "no_station_match",
  });

  const noAsMade = new Map(site.asMade);
  noAsMade.delete("site-strip-overview");
  expect(planStationSettingsCopy(site.widgets, stationWidgets(), asMadeOf(noAsMade), ALL_TABS).kept).toEqual([
    { widgetId: "site-strip-overview", reason: "no_as_made" },
  ]);
}

/** S5 — a station mimic on the layout arm, or on another preset, is the station's own: kept. */
export function assertAStationLayoutOrOtherPresetIsKept(): void {
  const site = siteFixture();
  const layout = replaceWidget(stationWidgets(), "station-mimic-electrical", {
    config: { source: "layout", layoutId: "0b5c3f2e-8a1d-4c6e-9f7a-2d3e4b5c6a7f", glyphSet: "iso" },
  });
  const other = replaceWidget(layout, "station-mimic-env", {
    config: { preset: "pump_station_overview", source: "preset", glyphSet: "iso" },
  });
  const plan = planStationSettingsCopy(site.widgets, other, asMadeOf(site.asMade), ALL_TABS);
  expect(plan.kept).toEqual([
    { widgetId: "site-mimic-electrical", reason: "mimic_not_same_preset" },
    { widgetId: "site-mimic-env", reason: "mimic_not_same_preset" },
  ]);
  expect(plan.updates).toHaveLength(4);
}

/** S6 — a station config that does not parse is never copied. */
export function assertAStationConfigThatDoesNotParseIsKept(): void {
  const site = siteFixture();
  const badStrip = replaceWidget(stationWidgets(), "station-strip-electrical", {
    config: { ...stationStripConfig("electrical"), defaultRange: "1y" },
  });
  const badBoth = replaceWidget(badStrip, "station-mimic-overview", {
    config: { preset: "pump_station_overview", source: "preset", glyphSet: "hand-drawn" },
  });
  const plan = planStationSettingsCopy(site.widgets, badBoth, asMadeOf(site.asMade), ALL_TABS);
  expect(plan.kept).toEqual([
    { widgetId: "site-mimic-overview", reason: "station_config_invalid" },
    { widgetId: "site-strip-electrical", reason: "station_config_invalid" },
  ]);
  expect(plan.updates).toHaveLength(4);

  // A key the widget write API's `.strict()` arm refuses: the read schema strips it, the copy
  // would keep it, and the next administrator save would fail. Kept.
  const extraKeys = replaceWidget(
    replaceWidget(stationWidgets(), "station-strip-env", { config: { ...stationStripConfig("env"), legacy: true } }),
    "station-mimic-env",
    { config: { ...stationMimicConfig("env"), zoom: 2 } },
  );
  expect(planStationSettingsCopy(site.widgets, extraKeys, asMadeOf(site.asMade), ALL_TABS).kept).toEqual([
    { widgetId: "site-mimic-env", reason: "station_config_invalid" },
    { widgetId: "site-strip-env", reason: "station_config_invalid" },
  ]);
}

/** S7 — a site widget already equal to its station widget gives no update. */
export function assertEqualConfigsGiveNoUpdate(): void {
  const site = siteFixture();
  const stations = stationWidgets();
  const copied = site.widgets.map((item) => ({
    ...item,
    config: structuredClone(stations.find((station) => station.id === item.id.replace("site-", "station-"))!.config),
  }));
  const plan = planStationSettingsCopy(copied, stations, asMadeOf(site.asMade), ALL_TABS);
  expect(plan.updates).toEqual([]);
  expect(plan.kept).toEqual([]);
  expect([...plan.unchanged].sort()).toEqual(site.widgets.map((item) => item.id).sort());

  // Key order is jsonb's, not the writer's: a reordered equal config is still equal.
  const reordered = replaceWidget(site.widgets, "site-mimic-env", {
    config: { glyphSet: "iso", source: "preset", preset: "pump_station_environment" },
  });
  const once = planStationSettingsCopy(reordered, stations, asMadeOf(site.asMade), ALL_TABS);
  expect(once.unchanged).toEqual(["site-mimic-env"]);
  expect(once.updates).toHaveLength(5);
}

/** S8 — a copy is considered when this run made it, or its stamp is NULL or below 3. */
export function assertConsidersCopyTruthTable(): void {
  expect(considersCopy({ madeThisRun: false, stockVersion: 3 })).toBe(false);
  expect(considersCopy({ madeThisRun: false, stockVersion: 4 })).toBe(false);
  expect(considersCopy({ madeThisRun: false, stockVersion: 1 })).toBe(true);
  expect(considersCopy({ madeThisRun: false, stockVersion: 2 })).toBe(true);
  expect(considersCopy({ madeThisRun: false, stockVersion: null })).toBe(true);
  expect(considersCopy({ madeThisRun: true, stockVersion: 3 })).toBe(true);
}

/** S9 — a station config naming a tab the site copy does not hold is the station's own: kept (Q4). */
export function assertAStationTabTheSiteCopyLacksIsKept(): void {
  const site = siteFixture();
  const stations = replaceWidget(stationWidgets(), "station-mimic-overview", {
    config: { ...stationMimicConfig("overview"), tabKey: "env" },
  });
  const plan = planStationSettingsCopy(site.widgets, stations, asMadeOf(site.asMade), new Set(["overview", "electrical"]));
  expect(plan.kept).toEqual([
    { widgetId: "site-mimic-overview", reason: "station_tab_absent" },
    { widgetId: "site-strip-env", reason: "station_tab_absent" },
  ]);
  expect(plan.updates.map((update) => update.widgetId).sort()).toEqual([
    "site-mimic-electrical",
    "site-mimic-env",
    "site-strip-electrical",
    "site-strip-overview",
  ]);
  // The same station widgets onto a copy that holds every tab: all six are copied.
  expect(planStationSettingsCopy(site.widgets, stations, asMadeOf(site.asMade), ALL_TABS).updates).toHaveLength(6);
}

/** S10 — a stored widget pairs with a planned one only when each is alone at its place. */
export function assertPairingNeedsOneWidgetEachWayPerPlace(): void {
  const site = siteFixture();
  const planned = site.widgets.map(({ tabKey, widgetType, gridX, gridY, gridW, gridH, config }) => ({
    tabKey,
    widgetType,
    gridX,
    gridY,
    gridW,
    gridH,
    config: structuredClone(config),
  }));
  expect(pairAsMadeConfigs(site.widgets, planned)).toEqual(site.asMade);

  // Two stored widgets on one rect: neither has an as-made config, so both are kept `no_as_made`.
  const twin = widget("site-mimic-env-twin", "env", "mimic", MIMIC_RECTS.env!, siteMimicConfig("env"));
  const storedTwins = pairAsMadeConfigs([...site.widgets, twin], planned);
  expect([...storedTwins.keys()].sort()).toEqual(
    site.widgets.map((item) => item.id).filter((id) => id !== "site-mimic-env").sort(),
  );
  expect(planStationSettingsCopy([...site.widgets, twin], stationWidgets(), storedTwins, ALL_TABS).kept).toEqual([
    { widgetId: "site-mimic-env", reason: "no_as_made" },
    { widgetId: "site-mimic-env-twin", reason: "no_as_made" },
  ]);

  // Two planned widgets on one rect: the stored widget there has no as-made config.
  const strip = planned.find((item) => item.tabKey === "overview" && item.widgetType === "trend_strip")!;
  const plannedTwins = pairAsMadeConfigs(site.widgets, [...planned, { ...strip, config: { defaultRange: "7d" } }]);
  expect(plannedTwins.has("site-strip-overview")).toBe(false);
  expect(plannedTwins.size).toBe(5);
}

// ── S11, S12: the writer on a scripted pool. Each SQL is answered by a fragment of its text; an
// SQL no fragment matches throws, so a new read cannot pass unseen. ──

const LOTAPATA = "CBLTPT1";
const STOCK_STRIP = PUMP_STATION_STANDARD_SITE_TEMPLATE.content.tabs
  .flatMap((tab) => tab.widgets)
  .find((item) => item.widgetType === "trend_strip" && item.key.startsWith("overview"))!;

type ScriptedRows = { readonly rows: readonly unknown[]; readonly rowCount?: number };

function scriptedPool(rowCounts: { readonly update: number; readonly stamp: number }): {
  readonly pool: Pick<pg.Pool, "query">;
  readonly sql: string[];
} {
  const catalog = loadPheCatalog();
  const stationSlug = pheSiteLayoutStations({
    ...catalog,
    rows: catalog.rows.filter((row) => row.StationCode === LOTAPATA),
  })[0]!.slug;
  const place = {
    tab_key: "overview",
    widget_type: "trend_strip",
    grid_x: STOCK_STRIP.gridX,
    grid_y: STOCK_STRIP.gridY,
    grid_w: STOCK_STRIP.gridW,
    grid_h: STOCK_STRIP.gridH,
  };
  const script: readonly [string, (params: readonly unknown[]) => ScriptedRows][] = [
    [
      "unnest($2::varchar[]",
      (params) => ({ rows: [{ id: (params[1] as string[]).includes(stationSlug) ? "station" : "site-1" }] }),
    ],
    ["FROM bms.dashboards WHERE organization_id = $1 AND location_id = $2", () => ({ rows: [{ id: "station-dash" }] })],
    ["SELECT slug FROM bms.locations", () => ({ rows: [{ slug: "site-one" }] })],
    [
      "FOR UPDATE OF d",
      () => ({
        rows: [
          { id: "copy", stock_version: 1, template_id: "tpl", template_code: PUMP_STATION_STANDARD_SITE_TEMPLATE.code },
        ],
      }),
    ],
    [
      "COALESCE(t.tab_key",
      (params) => ({
        rows: [
          params[0] === "copy"
            ? { id: "w-site", ...place, config: structuredClone(STOCK_STRIP.config) }
            : { id: "w-station", ...place, config: { ...STOCK_STRIP.config, segments: ["electrical"] } },
        ],
      }),
    ],
    ["SELECT tab_key FROM bms.dashboard_tabs", () => ({ rows: [{ tab_key: "overview" }] })],
    ["FROM bms.asset_points", () => ({ rows: [] })],
    [
      "FROM bms.dashboard_templates WHERE id",
      () => ({
        rows: [
          {
            id: "tpl",
            stock_version: 3,
            content: {
              widgets: [],
              tabs: [{ key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: [STOCK_STRIP] }],
            },
          },
        ],
      }),
    ],
    ["FROM bms.asset_groups", () => ({ rows: [] })],
    ["UPDATE bms.dashboard_widgets SET config", () => ({ rows: [], rowCount: rowCounts.update })],
    ["UPDATE bms.dashboards SET stock_version", () => ({ rows: [], rowCount: rowCounts.stamp })],
  ];
  const sql: string[] = [];
  const query = async (text: string, params: readonly unknown[] = []): Promise<ScriptedRows> => {
    const entry = script.find(([fragment]) => text.includes(fragment));
    if (!entry) throw new Error(`scriptedPool: no answer for ${text}`);
    sql.push(entry[0]);
    const answer = entry[1](params);
    return { rows: answer.rows, rowCount: answer.rowCount ?? answer.rows.length };
  };
  return { pool: { query } as unknown as Pick<pg.Pool, "query">, sql };
}

function runScripted(pool: Pick<pg.Pool, "query">, lines: string[]): ReturnType<typeof copyStationWidgetSettings> {
  const catalog = loadPheCatalog();
  return copyStationWidgetSettings(pool, "org", {
    catalog: { ...catalog, rows: catalog.rows.filter((row) => row.StationCode === LOTAPATA) },
    splitStationCodes: [LOTAPATA],
    madeDashboardIds: new Set(),
    choiceByGroupCode: {},
    log: (line) => {
      lines.push(line);
    },
  });
}

/** S11 — an update that writes no row is kept and logged, not counted; the step goes on and stamps. */
export async function assertAWidgetChangedDuringTheSeedIsKept(): Promise<void> {
  const { pool, sql } = scriptedPool({ update: 0, stamp: 1 });
  const lines: string[] = [];
  const outcome = await runScripted(pool, lines);
  expect(outcome.copies).toEqual([{ locationId: "site-1", dashboardId: "copy", copied: 0, considered: 1, kept: [] }]);
  expect(lines.filter((line) => line.endsWith("kept widget w-site: changed during the seed"))).toHaveLength(1);
  expect(lines.filter((line) => line.includes("copied 0 of 1"))).toHaveLength(1);
  expect(sql.filter((fragment) => fragment.startsWith("UPDATE bms.dashboard_widgets"))).toHaveLength(1);
  expect(sql.filter((fragment) => fragment.startsWith("UPDATE bms.dashboards"))).toHaveLength(1);
}

/** S12 — a stamp that writes no row throws. */
export async function assertAStampThatWritesNoRowThrows(): Promise<void> {
  const { pool } = scriptedPool({ update: 1, stamp: 0 });
  await expect(runScripted(pool, [])).rejects.toThrow(/stamped 0 of 1 rows/);
}
