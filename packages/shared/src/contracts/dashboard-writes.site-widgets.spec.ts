import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboard-writes.spec";

import {
  putDashboardWidgetsBodySchema,
  TAB_TARGET_UNKNOWN_MESSAGE,
} from "./dashboard-writes";

/**
 * `F3.73` (plan Task 3.2) — the five site widgets on `PUT /dashboards/:id/widgets`, and the two
 * catalog entries' write params. A sibling of `dashboards.schema.tabs.spec.ts` for the same
 * reason: `dashboards.schema.spec.ts` is at 990 of the 1000 lines. Assertions live here;
 * `dashboards.schema.site-widgets.test.ts` is the Vitest entry point (ADR 0014).
 */

// `points: []` is sent, as the mimic spec does: `points` has no default, only `sources` does.
const slot = { title: null, gridX: 0, gridY: 0, gridW: 3, gridH: 2, points: [] };
const overviewTab = { key: "overview", label: "Overview", sortOrder: 0 };
const hvacTab = { key: "hvac", label: "HVAC", sortOrder: 1 };

const card = (targetTabKey: string) => ({
  ...slot,
  widgetType: "module_summary_card" as const,
  config: { targetTabKey },
  tabKey: "overview",
});

const tabbed = (widget: unknown) => ({ tabs: [overviewTab, hvacTab], widgets: [widget] });

export function acceptsEachOfTheFiveSiteWidgets(): void {
  const widgets = [
    { ...slot, widgetType: "active_alarms_rail" as const, config: { rows: 10 }, tabKey: "overview" },
    { ...slot, widgetType: "active_alarms_rail" as const, config: {}, tabKey: "overview" },
    { ...slot, widgetType: "state_legend" as const, config: {}, tabKey: "overview" },
    { ...slot, widgetType: "asset_class_strip" as const, config: {}, tabKey: "overview" },
    card("hvac"),
    { ...slot, widgetType: "critical_systems_list" as const, config: {}, tabKey: "overview" },
  ];
  for (const widget of widgets) {
    expectAccepts(
      putDashboardWidgetsBodySchema,
      tabbed(widget),
      `a ${widget.widgetType} widget with no points and no sources must parse`,
    );
  }
}

export function refusesACardTargetingAnUnknownTab(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed(card("water")),
    ["widgets", 0, "config", "targetTabKey"],
    [TAB_TARGET_UNKNOWN_MESSAGE],
    "a module card whose targetTabKey names no tab of the request must be refused at that field",
  );
}

export function refusesACardOnADashboardWithoutTabs(): void {
  const { tabKey: _tabKey, ...untabbed } = card("hvac");
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [untabbed] },
    ["widgets", 0, "config", "targetTabKey"],
    [TAB_TARGET_UNKNOWN_MESSAGE],
    "a card on a legacy canvas links to no tab, so it must be refused",
  );
}

export function refusesACardWithoutATargetTabKey(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed({ ...slot, widgetType: "module_summary_card", config: {}, tabKey: "overview" }),
    ["widgets", 0, "config", "targetTabKey"],
    [],
    "targetTabKey is required on a module card",
  );
}

export function refusesAnUnknownKeyInASiteWidgetConfig(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed({ ...slot, widgetType: "state_legend", config: { colour: "red" }, tabKey: "overview" }),
    ["widgets", 0, "config"],
    [],
    "a site widget config is .strict(): a typo must not be stored and silently never rendered",
  );
}

export function refusesAPointOnASiteWidget(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed({
      ...slot,
      widgetType: "asset_class_strip",
      config: {},
      tabKey: "overview",
      points: [{ pointId: POINT_A }],
    }),
    ["widgets", 0, "points"],
    [],
    "a site widget binds nothing, so a point binding is capped at zero",
  );
}

const breakerTable = { ...slot, widgetType: "breaker_table" as const, config: {}, tabKey: "overview" };

/** `F3.74` (plan Task 4.1) — the sixth binds-nothing site arm, `breaker_table`. */
export function acceptsABreakerTable(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    tabbed(breakerTable),
    "a breaker_table widget with an empty config, no points and no sources must parse",
  );
}

export function refusesAPointOnABreakerTable(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed({ ...breakerTable, points: [{ pointId: POINT_A }] }),
    ["widgets", 0, "points"],
    [],
    "a breaker table binds nothing, so a point binding is capped at zero",
  );
}

export function refusesAnUnknownKeyInABreakerTableConfig(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed({ ...breakerTable, config: { rows: 5 } }),
    ["widgets", 0, "config"],
    [],
    "the breaker table config is .strict(): it configures nothing",
  );
}

export function refusesARailBeyondTwentyRows(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tabbed({ ...slot, widgetType: "active_alarms_rail", config: { rows: 21 }, tabKey: "overview" }),
    ["widgets", 0, "config", "rows"],
    [],
    "the rail draws at most 20 rows",
  );
}

const tableOn = (catalogKey: string, params: Record<string, unknown>) => ({
  widgets: [
    {
      ...slot,
      widgetType: "table" as const,
      config: {},
      sources: [{ catalogKey, params }],
    },
  ],
});

export function acceptsTheTwoAssetsCatalogEntries(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    tableOn("assets.list", {}),
    "a table binding assets.list with params {} must parse",
  );
  expectAccepts(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        {
          ...slot,
          widgetType: "value_tile" as const,
          config: {},
          sources: [{ catalogKey: "assets.offline.count", params: {} }],
        },
      ],
    },
    "a value_tile binding assets.offline.count with params {} must parse",
  );
}

export function refusesParamsOnTheTwoAssetsCatalogEntries(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    tableOn("assets.list", { locationId: "x" }),
    ["widgets", 0, "sources", 0, "params"],
    ["assets.list:"],
    "assets.list declares no params and is strict",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        {
          ...slot,
          widgetType: "value_tile" as const,
          config: {},
          sources: [{ catalogKey: "assets.offline.count", params: { groupId: "x" } }],
        },
      ],
    },
    ["widgets", 0, "sources", 0, "params"],
    ["assets.offline.count:"],
    "assets.offline.count declares no params and is strict",
  );
}
