/**
 * `F3.73` D11 — the builder's tab-state helpers, moved unchanged out of `dashboard-builder-form.ts`
 * (E1.4 R14) and re-exported from there, so no importer changes.
 */
import type { DashboardWidgetRow, TabWritePayload } from "./dashboard-builder-form";

/**
 * `F3.73` D11 — the tab set and the rows edited together. A tab edit that changes a key, or
 * removes a tab, must move the rows with it, so the edits below take and return both. They live
 * here rather than in the panel's handlers because a `.tsx` handler is outside the coverage
 * denominator (`widgetRowAfterRemovingSource`'s reason).
 */
export type BuilderTabsState = {
  readonly tabs: readonly TabWritePayload[];
  readonly rows: readonly DashboardWidgetRow[];
};

const renumbered = (tabs: readonly TabWritePayload[]): TabWritePayload[] =>
  tabs.map((tab, position) => ({ ...tab, sortOrder: position }));

/**
 * Adds a tab with the first free `tab-N` key and no group. **The first tab adopts every widget
 * already on the canvas**: the builder shows one tab's widgets at a time, so an untabbed widget
 * would be hidden while "needs every widget on a tab" blocks Save.
 *
 * The set is renumbered from position (review finding): a site-layout copy keeps the template's
 * `sortOrder`s with gaps where tabs were omitted (`0, 1, 2, 3, 6`), so `state.tabs.length` would
 * save the new tab before the last stored one, or tie with it, while the panel shows it last.
 */
export function addBuilderTab(state: BuilderTabsState): BuilderTabsState & { key: string } {
  const taken = new Set(state.tabs.map((tab) => tab.key));
  let n = 1;
  while (taken.has(`tab-${n}`)) {
    n += 1;
  }
  const key = `tab-${n}`;
  const tabs = renumbered([...state.tabs, { key, label: `Tab ${n}`, sortOrder: 0, assetGroupId: null }]);
  const rows = state.tabs.length === 0 ? state.rows.map((row) => ({ ...row, tabKey: key })) : [...state.rows];
  return { tabs, rows, key };
}

/** The config keys that name a tab of the same dashboard: a module card's link, a mimic's group
 * tab (`F3.74`) and a trend strip's scope (`F4.305`). A rename moves every one of them. */
const TAB_NAMING_CONFIG_KEYS = ["targetTabKey", "mimicTabKey", "stripTabKey"] as const;

/**
 * Re-keys one tab, and moves its widgets and every config key that names it (a module summary
 * card's link, a mimic's or a trend strip's `tabKey`) with it — else the renamed dashboard fails
 * its own tab-key rules and cannot be saved (`F4.305` review).
 * Answers `null` when another tab holds the key: applying it would put two tabs' widgets under one
 * key, and no later edit could tell them apart again.
 */
export function renameBuilderTabKey(state: BuilderTabsState, index: number, key: string): BuilderTabsState | null {
  const tab = state.tabs[index];
  if (!tab) {
    return state;
  }
  if (state.tabs.some((other, position) => position !== index && other.key === key)) {
    return null;
  }
  const from = tab.key;
  return {
    tabs: state.tabs.map((other, position) => (position === index ? { ...other, key } : other)),
    rows: state.rows.map((row) => {
      const next = row.tabKey === from ? { ...row, tabKey: key } : row;
      const named = TAB_NAMING_CONFIG_KEYS.filter((field) => next.config[field] === from);
      if (named.length === 0) {
        return next;
      }
      const config = { ...next.config };
      for (const field of named) {
        config[field] = key;
      }
      return { ...next, config };
    }),
  };
}

/** Moves one tab by `delta` places and renumbers `sortOrder` from position. A move past either
 * end answers the same array. */
export function moveBuilderTab(
  tabs: readonly TabWritePayload[],
  index: number,
  delta: -1 | 1,
): readonly TabWritePayload[] {
  const target = index + delta;
  if (target < 0 || target >= tabs.length) {
    return tabs;
  }
  const next = [...tabs];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return renumbered(next);
}

/**
 * Removes one tab **and its widgets** — the API cascades them on save, so the builder shows the
 * same result before the save. A card that linked to the tab stays, with the target problem
 * `dashboardBuilderErrors` reports. With no tab left the dashboard is one canvas again, so no
 * widget keeps a `tabKey` (the API refuses one on a tab-less body).
 */
export function removeBuilderTab(state: BuilderTabsState, index: number): BuilderTabsState {
  const tab = state.tabs[index];
  if (!tab) {
    return state;
  }
  const tabs = renumbered(state.tabs.filter((_, position) => position !== index));
  const kept = state.rows.filter((row) => row.tabKey !== tab.key);
  const rows =
    tabs.length > 0
      ? kept
      : kept.map((row) => {
          const { tabKey: _dropped, ...rest } = row;
          return rest;
        });
  return { tabs, rows };
}
