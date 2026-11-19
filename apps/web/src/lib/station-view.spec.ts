import type { DashboardDto } from "@bms/shared";
import { expect } from "vitest";

import { SITE_ASSETS_TAB, SITE_TRENDS_TAB } from "./smoc-pages";
import { stationTabs } from "./station-view";

/**
 * `F4.240` part b (ADR 0140 decision 3e, plan D8, Task 2.1) — `stationTabs`, the station's tab
 * chooser: the union of the sites' dashboard tab keys, first seen wins (sites in list order, then
 * each dashboard's `sortOrder`). Vitest entry point: `station-view.test.ts` (ADR 0014).
 */

type TabsOnly = Pick<DashboardDto, "tabs">;

function tab(key: string, label: string, sortOrder: number): DashboardDto["tabs"][number] {
  return {
    id: `tab-${key}-${sortOrder}`,
    dashboardId: "d",
    organizationId: "o",
    key,
    label,
    sortOrder,
    assetGroupId: null,
  };
}

function dashboard(...tabs: DashboardDto["tabs"]): TabsOnly {
  return { tabs };
}

/** ST-T1 — two dashboards with the same three keys give three entries, in `sortOrder`. */
export function runStationTabsSameKeys(): void {
  const first = dashboard(tab("c", "C", 2), tab("a", "A", 0), tab("b", "B", 1));
  const second = dashboard(tab("b", "B two", 0), tab("c", "C two", 1), tab("a", "A two", 2));
  expect(stationTabs([first, second])).toEqual([
    { key: "a", label: "A" },
    { key: "b", label: "B" },
    { key: "c", label: "C" },
  ]);
}

/** ST-T2 — a key only the second site holds comes after the first site's keys. */
export function runStationTabsSecondOnlyKeyComesAfter(): void {
  const first = dashboard(tab("a", "A", 0), tab("b", "B", 1));
  const second = dashboard(tab("x", "X", 0), tab("a", "A", 1));
  expect(stationTabs([first, second]).map((entry) => entry.key)).toEqual(["a", "b", "x"]);
}

/** ST-T3 — `assets` and `trends` keys are dropped: the page owns those segments. */
export function runStationTabsDropsPageSegments(): void {
  const first = dashboard(tab(SITE_ASSETS_TAB, "Assets", 0), tab("a", "A", 1), tab(SITE_TRENDS_TAB, "Trends", 2));
  expect(stationTabs([first])).toEqual([{ key: "a", label: "A" }]);
}

/** ST-T4 — an `undefined` entry (a pending or non-dashboard site) is skipped. */
export function runStationTabsSkipsUndefined(): void {
  const second = dashboard(tab("b", "B", 0));
  expect(stationTabs([undefined, second])).toEqual([{ key: "b", label: "B" }]);
}

/** ST-T5 — every entry `undefined` gives `[]`. */
export function runStationTabsAllUndefined(): void {
  expect(stationTabs([undefined, undefined])).toEqual([]);
}

/** ST-T6 — the cached DTO's tab order is never changed (the rule sorts a copy). */
export function runStationTabsLeavesTheDtoAlone(): void {
  const first = dashboard(tab("b", "B", 1), tab("a", "A", 0));
  stationTabs([first]);
  expect(first.tabs.map((entry) => entry.key)).toEqual(["b", "a"]);
}
