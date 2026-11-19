import { expect } from "vitest";

import {
  considersCopy,
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
  const plan = planStationSettingsCopy(site.widgets, stationWidgets(), asMadeOf(site.asMade));
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
  const plan = planStationSettingsCopy(edited, stationWidgets(), asMadeOf(site.asMade));
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
  const plan = planStationSettingsCopy([...site.widgets, siteTile], [...stationWidgets(), stationTile], asMadeOf(site.asMade));
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
  const plan = planStationSettingsCopy(site.widgets, stations, asMadeOf(site.asMade));
  expect(plan.kept).toEqual([
    { widgetId: "site-mimic-overview", reason: "several_station_matches" },
    { widgetId: "site-strip-env", reason: "no_station_match" },
  ]);
  expect(plan.updates).toHaveLength(4);

  const moved = replaceWidget(stationWidgets(), "station-strip-env", { gridH: 6 });
  expect(planStationSettingsCopy(site.widgets, moved, asMadeOf(site.asMade)).kept).toEqual([
    { widgetId: "site-strip-env", reason: "no_station_match" },
  ]);

  const otherType = replaceWidget(stationWidgets(), "station-mimic-env", { widgetType: "trend_strip" });
  expect(planStationSettingsCopy(site.widgets, otherType, asMadeOf(site.asMade)).kept).toContainEqual({
    widgetId: "site-mimic-env",
    reason: "no_station_match",
  });

  const noAsMade = new Map(site.asMade);
  noAsMade.delete("site-strip-overview");
  expect(planStationSettingsCopy(site.widgets, stationWidgets(), asMadeOf(noAsMade)).kept).toEqual([
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
  const plan = planStationSettingsCopy(site.widgets, other, asMadeOf(site.asMade));
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
  const plan = planStationSettingsCopy(site.widgets, badBoth, asMadeOf(site.asMade));
  expect(plan.kept).toEqual([
    { widgetId: "site-mimic-overview", reason: "station_config_invalid" },
    { widgetId: "site-strip-electrical", reason: "station_config_invalid" },
  ]);
  expect(plan.updates).toHaveLength(4);
}

/** S7 — a site widget already equal to its station widget gives no update. */
export function assertEqualConfigsGiveNoUpdate(): void {
  const site = siteFixture();
  const stations = stationWidgets();
  const copied = site.widgets.map((item) => ({
    ...item,
    config: structuredClone(stations.find((station) => station.id === item.id.replace("site-", "station-"))!.config),
  }));
  const plan = planStationSettingsCopy(copied, stations, asMadeOf(site.asMade));
  expect(plan.updates).toEqual([]);
  expect(plan.kept).toEqual([]);
  expect([...plan.unchanged].sort()).toEqual(site.widgets.map((item) => item.id).sort());

  // Key order is jsonb's, not the writer's: a reordered equal config is still equal.
  const reordered = replaceWidget(site.widgets, "site-mimic-env", {
    config: { glyphSet: "iso", source: "preset", preset: "pump_station_environment" },
  });
  const once = planStationSettingsCopy(reordered, stations, asMadeOf(site.asMade));
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
