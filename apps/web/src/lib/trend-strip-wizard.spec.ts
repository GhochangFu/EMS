import { expect } from "vitest";

import {
  appendTrendStripWidgetsBodySchema,
  appendWidgetBodySchema,
  MAX_DASHBOARD_WIDGETS,
  TREND_STRIP_WIDGET_MAX_POINTS,
} from "@bms/shared";
import type { SiteTrendPointsDto } from "@bms/shared";

import { blankDashboardWidgetRow, type DashboardWidgetRow } from "./dashboard-builder-form";
import {
  appendBodyFor,
  canAddPoint,
  defaultSelection,
  placeInDraft,
  setPointColor,
  stripConfigFor,
  togglePoint,
  toggleSegment,
  wizardTabs,
  type WizardSelection,
} from "./trend-strip-wizard";
import { WIDGET_CATALOG } from "./widget-catalog";

/**
 * `F4.306` PR 2 U11 (ADR 0108 Amendment 7 items 5 and 6) — the trend strip wizard's pure module.
 * Assertions live here; `trend-strip-wizard.test.ts` is the Vitest entry point (ADR 0014).
 */

const TAB_A = "11111111-1111-4111-8111-111111111111";
const TAB_B = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";

const EMPTY: WizardSelection = { segments: [], points: [], colors: {} };

type DtoWidget = { widgetType: string; gridX: number; gridY: number; gridH: number; tabId: string | null };

function dtoWidget(tabId: string | null, widgetType = "value_tile", gridY = 0, gridH = 2): DtoWidget {
  return { widgetType, gridX: 0, gridY, gridH, tabId };
}

/** Two DTO tabs, stored out of order so the sort is visible. */
const DTO_TABS = [
  { id: TAB_B, key: "plant", label: "Plant", sortOrder: 1, assetGroupId: GROUP },
  { id: TAB_A, key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
];

function segment(domain: string, codes: readonly string[], inactive: readonly string[] = []) {
  return {
    domain,
    label: `Label ${domain}`,
    source: "catalog" as const,
    points: codes.map((code) => ({ code, name: `Name ${code}`, unit: null, active: !inactive.includes(code) })),
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function row(tabKey: string | undefined, widgetType: DashboardWidgetRow["widgetType"], gridY: number, gridH: number) {
  const base = blankDashboardWidgetRow(widgetType);
  return { ...base, ...(tabKey !== undefined ? { tabKey } : {}), gridY, gridH, title: `${widgetType}@${gridY}` };
}

function selectionOf(count: number): WizardSelection {
  return {
    segments: ["seg-a"],
    points: Array.from({ length: count }, (_, index) => `seg-a:p${index}`),
    colors: {},
  };
}

// --- wizardTabs ---------------------------------------------------------------------------------

/** The DTO shape (`tabId`): sorted by `sortOrder`, `hasStrip` on the tab that holds a strip. */
export function theTabListMarksHasStrip(): void {
  const tabs = wizardTabs({
    tabs: DTO_TABS,
    widgets: [dtoWidget(TAB_A), dtoWidget(TAB_B, "trend_strip"), dtoWidget(TAB_B)],
  });
  expect(tabs.map((tab) => tab.key)).toEqual(["overview", "plant"]);
  expect(tabs.map((tab) => tab.hasStrip)).toEqual([false, true]);
  expect(tabs.map((tab) => tab.count)).toEqual([1, 2]);
  expect(tabs[1]).toMatchObject({ label: "Plant", assetGroupId: GROUP });
}

/** A tab at the cap with no strip cannot take one (an insert would be a 409). */
export function aFullTabWithoutAStripIsAtCap(): void {
  const full = Array.from({ length: MAX_DASHBOARD_WIDGETS }, () => dtoWidget(TAB_A));
  const tabs = wizardTabs({ tabs: DTO_TABS, widgets: [...full, dtoWidget(TAB_B)] });
  expect(tabs.map((tab) => tab.atCap)).toEqual([true, false]);
}

/** A full tab that holds a strip is not at cap: the wizard replaces, and a replace adds no row. */
export function aFullTabWithAStripIsNotAtCap(): void {
  const widgets = [
    ...Array.from({ length: MAX_DASHBOARD_WIDGETS - 1 }, () => dtoWidget(TAB_A)),
    dtoWidget(TAB_A, "trend_strip"),
  ];
  const [overview] = wizardTabs({ tabs: DTO_TABS, widgets });
  expect(overview.count).toBe(MAX_DASHBOARD_WIDGETS);
  expect(overview.hasStrip).toBe(true);
  expect(overview.atCap).toBe(false);
}

/** The builder row shape (`tabKey`) reads through the same function. */
export function theBuilderRowShapeReadsByTabKey(): void {
  const tabs = wizardTabs({
    tabs: [
      { key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
      { key: "plant", label: "Plant", sortOrder: 1, assetGroupId: GROUP },
    ],
    widgets: [row("plant", "trend_strip", 0, 4), row("overview", "value_tile", 0, 2), row("overview", "value_tile", 2, 2)],
  });
  expect(tabs.map((tab) => [tab.key, tab.count, tab.hasStrip])).toEqual([
    ["overview", 2, false],
    ["plant", 1, true],
  ]);
}

/** A dashboard without tabs is one row, `key: null`, labelled "Dashboard", counting every widget. */
export function aTablessDashboardIsOneRow(): void {
  const tabs = wizardTabs({ tabs: [], widgets: [dtoWidget(null), dtoWidget(null, "trend_strip")] });
  expect(tabs).toEqual([{ key: null, label: "Dashboard", assetGroupId: null, hasStrip: true, count: 2, atCap: false }]);
}

// --- defaultSelection, togglePoint, toggleSegment -----------------------------------------------

/** The first 3 active points of each chosen segment, in list order, segments in the chosen order. */
export function theDefaultPicksThreeActivePerSegment(): void {
  const lists: SiteTrendPointsDto["segments"] = [
    segment("seg-a", ["a1", "a2", "a3", "a4", "a5"], ["a2"]),
    segment("seg-b", ["b1", "b2", "b3", "b4"]),
    segment("seg-c", ["c1"]),
  ];
  const selection = defaultSelection(lists, ["seg-b", "seg-a"]);
  expect(selection).toEqual({
    segments: ["seg-b", "seg-a"],
    points: ["seg-b:b1", "seg-b:b2", "seg-b:b3", "seg-a:a1", "seg-a:a3", "seg-a:a4"],
    colors: {},
  });
}

/** Eleven segments of 3 is 33 points: the default stops at 30, in segment order. */
export function theDefaultStopsAtThirty(): void {
  const codes = Array.from({ length: 11 }, (_, index) => `seg-${index}`);
  const lists = codes.map((code) => segment(code, ["x", "y", "z", "w"]));
  const selection = defaultSelection(lists, codes);
  expect(selection.points).toHaveLength(TREND_STRIP_WIDGET_MAX_POINTS);
  expect(selection.points.at(-1)).toBe("seg-9:z");
  expect(selection.points.some((key) => key.startsWith("seg-10:"))).toBe(false);
}

/** The 30th point is accepted. */
export function theThirtiethToggleIsAccepted(): void {
  const before = selectionOf(TREND_STRIP_WIDGET_MAX_POINTS - 1);
  expect(canAddPoint(before)).toBe(true);
  const after = togglePoint(before, "seg-a:last");
  expect(after.points).toHaveLength(TREND_STRIP_WIDGET_MAX_POINTS);
  expect(after.points.at(-1)).toBe("seg-a:last");
}

/** A 31st point is refused: the selection comes back unchanged. */
export function theThirtyFirstToggleIsRefused(): void {
  const before = selectionOf(TREND_STRIP_WIDGET_MAX_POINTS);
  expect(canAddPoint(before)).toBe(false);
  expect(togglePoint(before, "seg-a:extra")).toEqual(before);
}

/** Toggling a chosen point off drops it and its colour. */
export function togglingAPointOffDropsItsColour(): void {
  const before: WizardSelection = { segments: ["seg-a"], points: ["seg-a:p0", "seg-a:p1"], colors: { "seg-a:p0": "series-2" } };
  expect(togglePoint(before, "seg-a:p0")).toEqual({ segments: ["seg-a"], points: ["seg-a:p1"], colors: {} });
}

/** Dropping a segment drops its points and their colours, and leaves another segment's alone. */
export function droppingASegmentDropsItsPointsAndColours(): void {
  const before: WizardSelection = {
    segments: ["seg-a", "seg-b"],
    points: ["seg-a:p0", "seg-b:p0", "seg-a:p1"],
    colors: { "seg-a:p0": "series-1", "seg-b:p0": "series-3" },
  };
  expect(toggleSegment(before, "seg-a")).toEqual({
    segments: ["seg-b"],
    points: ["seg-b:p0"],
    colors: { "seg-b:p0": "series-3" },
  });
}

/** Adding a segment appends its code and chooses no point. */
export function addingASegmentAppendsIt(): void {
  expect(toggleSegment(EMPTY, "seg-a")).toEqual({ segments: ["seg-a"], points: [], colors: {} });
}

/** A role writes `colors[key]`; `null` (the "Default" option) deletes the key. */
export function aColourIsSetAndDefaultDeletesIt(): void {
  const chosen = setPointColor(selectionOf(1), "seg-a:p0", "series-4");
  expect(chosen.colors).toEqual({ "seg-a:p0": "series-4" });
  expect(Object.keys(setPointColor(chosen, "seg-a:p0", null).colors)).toEqual([]);
}

// --- stripConfigFor -----------------------------------------------------------------------------

/** A tab bound to a group scopes the strip: `tabKey` is the tab's key, in the schema's key order. */
export function aGroupTabSetsTabKey(): void {
  const selection: WizardSelection = { segments: ["seg-a"], points: ["seg-a:p0"], colors: { "seg-a:p0": "series-2" } };
  const config = stripConfigFor(selection, "7d", { key: "plant", assetGroupId: GROUP });
  expect(JSON.stringify(config)).toBe(
    JSON.stringify({
      tabKey: "plant",
      defaultRange: "7d",
      segments: ["seg-a"],
      points: ["seg-a:p0"],
      colors: { "seg-a:p0": "series-2" },
    }),
  );
}

/** The Overview (no group) omits `tabKey`: the strip draws the whole site. */
export function theOverviewOmitsTabKey(): void {
  const config = stripConfigFor(selectionOf(1), "24h", { key: "overview", assetGroupId: null });
  expect(Object.keys(config)).toEqual(["defaultRange", "segments", "points"]);
}

/** An empty `points` (and `colors`) is omitted — `.min(1)` would refuse `[]`. */
export function emptyPointsAreOmitted(): void {
  const config = stripConfigFor({ segments: ["seg-a"], points: [], colors: {} }, "24h", { key: null, assetGroupId: null });
  expect(config).toEqual({ defaultRange: "24h", segments: ["seg-a"] });
}

/** No selection at all is exactly the `F4.305` config. */
export function noSelectionIsTheF4305Config(): void {
  expect(JSON.stringify(stripConfigFor(EMPTY, "30d", { key: null, assetGroupId: null }))).toBe('{"defaultRange":"30d"}');
}

// --- placeInDraft -------------------------------------------------------------------------------

function stripRow(tabKey: string, gridY: number): DashboardWidgetRow {
  const base = row(tabKey, "trend_strip", gridY, 4);
  return {
    ...base,
    id: "44444444-4444-4444-8444-444444444444",
    gridX: 1,
    gridW: 10,
    title: "Stored strip",
    config: { ...base.config, stripTabKey: "plant", stripRange: "30d", stripColors: { "seg-a:old": "series-8" } },
  };
}

/** Replace keeps the row's id, geometry and title, and every other row byte-identical. */
export function replaceKeepsTheRowAndEveryOther(): void {
  const rows = [row("overview", "value_tile", 0, 2), stripRow("plant", 6), row("plant", "value_tile", 0, 3)];
  const before = JSON.stringify([rows[0], rows[2]]);
  const config = stripConfigFor(selectionOf(2), "24h", { key: "overview", assetGroupId: null });
  const next = placeInDraft(rows, "plant", config);
  expect(next).toHaveLength(3);
  expect(JSON.stringify([next[0], next[2]])).toBe(before);
  const { config: _replaced, ...identity } = next[1];
  const { config: _stored, ...storedIdentity } = rows[1];
  expect(JSON.stringify(identity)).toBe(JSON.stringify(storedIdentity));
  expect(next[1].config.stripRange).toBe("24h");
  expect(next[1].config.stripPoints).toEqual(["seg-a:p0", "seg-a:p1"]);
}

/** Replace removes a stored field the new config does not hold (a stale `stripColors`, `stripTabKey`). */
export function replaceRemovesAStaleColors(): void {
  const config = stripConfigFor(selectionOf(1), "24h", { key: "plant", assetGroupId: null });
  const [replaced] = placeInDraft([stripRow("plant", 0)], "plant", config);
  expect(replaced.config.stripColors).toBeUndefined();
  expect(replaced.config.stripTabKey).toBeUndefined();
}

/** Insert lands at `gridX 0`, at the foot of THAT tab: a taller widget on another tab does not move it. */
export function insertLandsAtTheFootOfItsTabOnly(): void {
  const rows = [row("overview", "value_tile", 0, 2), row("overview", "value_tile", 2, 5), row("plant", "value_tile", 20, 6)];
  const config = stripConfigFor(selectionOf(1), "24h", { key: "overview", assetGroupId: null });
  const next = placeInDraft(rows, "overview", config);
  expect(next).toHaveLength(4);
  expect(JSON.stringify(next.slice(0, 3))).toBe(JSON.stringify(rows));
  expect(next[3]).toMatchObject({ widgetType: "trend_strip", tabKey: "overview", gridX: 0, gridY: 7 });
}

/** Insert's size is the catalog's `trend_strip` default (the full width, the strip's rows). */
export function insertSizeIsTheCatalogDefault(): void {
  const config = stripConfigFor(selectionOf(1), "7d", { key: null, assetGroupId: null });
  const [inserted] = placeInDraft([], undefined, config);
  expect(inserted.gridW).toBe(WIDGET_CATALOG.trend_strip.defaultSize.w);
  expect(inserted.gridH).toBe(WIDGET_CATALOG.trend_strip.defaultSize.h);
  expect(inserted).not.toHaveProperty("tabKey");
  expect(inserted.config).toMatchObject({ stripRange: "7d", stripSegments: ["seg-a"], stripPoints: ["seg-a:p0"] });
}

/** An empty tab inserts at `gridY 0`. */
export function anEmptyTabInsertsAtTop(): void {
  const rows = [row("overview", "value_tile", 3, 4)];
  const config = stripConfigFor(EMPTY, "24h", { key: "plant", assetGroupId: GROUP });
  const next = placeInDraft(rows, "plant", config);
  expect(next[1]).toMatchObject({ tabKey: "plant", gridX: 0, gridY: 0 });
  expect(next[1].config.stripTabKey).toBe("plant");
}

// --- appendBodyFor ------------------------------------------------------------------------------

/** One strip per chosen tab in the given order; the body is arm 1 of the append union. */
export function theAppendBodyIsTheTrendArm(): void {
  const selection: WizardSelection = { segments: ["seg-a"], points: ["seg-a:p0"], colors: { "seg-a:p0": "series-2" } };
  const body = appendBodyFor(selection, "24h", [
    { key: "overview", assetGroupId: null },
    { key: "plant", assetGroupId: GROUP },
  ]);
  expect(body.strips.map((strip) => strip.tabKey)).toEqual(["overview", "plant"]);
  expect(body.strips[1].config.tabKey).toBe("plant");
  expect(appendTrendStripWidgetsBodySchema.safeParse(body).success).toBe(true);
  expect(appendWidgetBodySchema.safeParse(body).success).toBe(true);
}

/** A tab-less dashboard's strip carries no `tabKey`. */
export function aTablessAppendBodyHasNoTabKey(): void {
  const body = appendBodyFor(EMPTY, "24h", [{ key: null, assetGroupId: null }]);
  expect(JSON.stringify(body)).toBe('{"widgetType":"trend_strip","strips":[{"config":{"defaultRange":"24h"}}]}');
  expect(appendTrendStripWidgetsBodySchema.safeParse(body).success).toBe(true);
}

/** A chart-looking body (`points` beside the trend `widgetType`) is not the trend arm. */
export function aChartLookingBodyIsNotTheTrendArm(): void {
  const body = { ...appendBodyFor(EMPTY, "24h", [{ key: null, assetGroupId: null }]), points: [] };
  expect(appendTrendStripWidgetsBodySchema.safeParse(body).success).toBe(false);
  expect(appendWidgetBodySchema.safeParse(body).success).toBe(false);
}
