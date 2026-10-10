import { MAX_DASHBOARD_TABS } from "./dashboard-tabs";
import { MAX_DASHBOARD_WIDGETS } from "./dashboard-builder";

import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboard-writes.spec";

import {
  DUPLICATE_TAB_ID_MESSAGE,
  DUPLICATE_TAB_KEY_MESSAGE,
  putDashboardWidgetsBodySchema,
  TAB_KEY_REQUIRED_MESSAGE,
  TAB_KEY_UNKNOWN_MESSAGE,
} from "./dashboard-writes";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.73` (plan D2, Task 1.4) — the tabs half of `PUT /dashboards/:id/widgets`. A new sibling
 * file, not an addition to `dashboard-writes.spec.ts`: that file is at 990 lines against the
 * repo's 1000-line cap (§4.5), and `dashboard-writes.mimic.spec.ts` is the precedent for the
 * split. Assertions live here; `dashboard-writes.tabs.test.ts` is the Vitest entry point
 * (ADR 0014). One exported function per claim, so a failing claim cannot hide the next.
 */

const GROUP_A = "33333333-3333-4333-8333-333333333333";

const tile = (tabKey?: string, gridY = 0) => ({
  widgetType: "value_tile" as const,
  title: null,
  gridX: 0,
  gridY,
  gridW: 3,
  gridH: 2,
  config: {},
  points: [{ pointId: POINT_A }],
  ...(tabKey === undefined ? {} : { tabKey }),
});

const overviewTab = { key: "overview", label: "Overview", sortOrder: 0 };
const electricalTab = { key: "electrical", label: "Electrical", sortOrder: 1, assetGroupId: GROUP_A };

export function acceptsATabbedBody(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { tabs: [overviewTab, electricalTab], widgets: [tile("overview"), tile("electrical")] },
    "two tabs with one widget each, every widget naming a tab of the request, must parse",
  );
}

export function refusesAWidgetNamingAnUnknownTab(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [overviewTab], widgets: [tile("hvac")] },
    ["widgets", 0, "tabKey"],
    [TAB_KEY_UNKNOWN_MESSAGE],
    "a widget whose tabKey names no tab of the request must be refused at its tabKey",
  );
}

export function refusesAWidgetWithoutATabKeyWhenTheBodyHasTabs(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [overviewTab], widgets: [tile()] },
    ["widgets", 0, "tabKey"],
    [TAB_KEY_REQUIRED_MESSAGE],
    "with tabs present, a widget without a tabKey sits on no tab and must be refused",
  );
}

export function refusesTwoTabsWithOneKey(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [overviewTab, { ...electricalTab, key: "overview" }], widgets: [tile("overview")] },
    ["tabs", 1, "key"],
    [DUPLICATE_TAB_KEY_MESSAGE],
    "two tabs sharing one key must be refused at the second tab's key",
  );
}

/** Two body tabs naming one stored id would merge into one row and answer 200. Different keys,
 * so only the id rule can fire. Mutation: drop the id check => red at ["tabs", 1, "id"]. */
export function refusesTwoTabsWithOneId(): void {
  const storedId = "44444444-4444-4444-8444-444444444444";
  const body = {
    tabs: [
      { ...overviewTab, id: storedId },
      { ...electricalTab, id: storedId },
    ],
    widgets: [tile("overview")],
  };
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    body,
    ["tabs", 1, "id"],
    [DUPLICATE_TAB_ID_MESSAGE],
    "two tabs naming one stored id must be refused at the second tab's id",
  );
  const result = putDashboardWidgetsBodySchema.safeParse(body);
  assert(
    !JSON.stringify(result.error?.issues ?? []).includes(storedId),
    "the duplicate-id refusal must not echo the id",
  );
}

export function refusesATabKeyOnAnEmptyTabList(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [], widgets: [tile("overview")] },
    ["widgets", 0, "tabKey"],
    [TAB_KEY_UNKNOWN_MESSAGE],
    "tabs: [] is the legacy canvas, so a widget naming a tabKey there names no tab",
  );
}

export function refusesATabKeyWhenTabsAreAbsent(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [tile("overview")] },
    ["widgets", 0, "tabKey"],
    [TAB_KEY_UNKNOWN_MESSAGE],
    "an absent tabs list is the legacy canvas too, so a tabKey there names no tab",
  );
}

export function refusesMoreThanTheCapOnOneTab(): void {
  const widgets = Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, (_unused, i) => tile("overview", i * 2));
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [overviewTab], widgets },
    ["widgets"],
    [`at most ${MAX_DASHBOARD_WIDGETS}`, "overview"],
    `${MAX_DASHBOARD_WIDGETS + 1} widgets on ONE tab must be refused — the cap is per tab`,
  );
}

export function acceptsMoreThanTheCapAcrossTwoTabs(): void {
  const onOverview = Array.from({ length: MAX_DASHBOARD_WIDGETS }, (_unused, i) => tile("overview", i * 2));
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { tabs: [overviewTab, electricalTab], widgets: [...onOverview, tile("electrical")] },
    `${MAX_DASHBOARD_WIDGETS + 1} widgets across TWO tabs must parse — neither tab is over the cap`,
  );
}

export function refusesMoreThanTheCapOnTheLegacyCanvas(): void {
  const widgets = Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, (_unused, i) => tile(undefined, i * 2));
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets },
    ["widgets"],
    [`at most ${MAX_DASHBOARD_WIDGETS}`],
    "the legacy canvas keeps its cap: it is one tab's worth",
  );
}

export function refusesMoreThanMaxTabs(): void {
  const tabs = Array.from({ length: MAX_DASHBOARD_TABS + 1 }, (_unused, i) => ({
    key: `tab-${i}`,
    label: `Tab ${i}`,
    sortOrder: i,
  }));
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs, widgets: [tile("tab-0")] },
    ["tabs"],
    [`${MAX_DASHBOARD_TABS}`],
    `${MAX_DASHBOARD_TABS + 1} tabs must be refused`,
  );
}

export function refusesTheReservedAssetsKey(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [{ ...overviewTab, key: "assets" }], widgets: [tile("assets")] },
    ["tabs", 0, "key"],
    ["reserved"],
    "the assets key is the site page's own segment and must be refused",
  );
}

export function refusesAnUnrecognizedTabField(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { tabs: [{ ...overviewTab, locationId: GROUP_A }], widgets: [tile("overview")] },
    ["tabs", 0],
    ["locationId"],
    "a tab is strict — its location is the dashboard's, never the caller's",
  );
}
