import type { WidgetConfigRow } from "./widget-config-form";

/**
 * `F3.74` plan D7 — which tab a mimic resolves through, as the builder decides it. A mimic on a
 * group-bound tab resolves through that tab; a mimic on a tab with no group names one through
 * `config.tabKey` (`mimicTabKey` on the form row). A sibling of `dashboard-builder-form.ts`, which
 * sits near the §4.5 line cap; it imports only types, so neither file imports the other at run time.
 */

/** A tab as these rules read it: its key and whether it binds an asset group. */
type MimicTab = { readonly key: string; readonly assetGroupId: string | null };

/** The mimic-relevant part of a builder row: its type, its tab and its config. */
type MimicTabRow = { readonly widgetType: string; readonly tabKey?: string; readonly config: WidgetConfigRow };

/** Whether the tab a widget sits on binds an asset group — a mimic there needs no `mimicTabKey`. */
export function ownTabBindsGroup(tabKey: string | undefined, tabs: readonly MimicTab[]): boolean {
  return tabKey !== undefined && tabs.some((tab) => tab.key === tabKey && tab.assetGroupId !== null);
}

/**
 * Whether the inspector shows the "Resolves through tab" select: a mimic whose own tab binds no
 * group, on a dashboard where some tab binds one. A row that already stores a key keeps the select
 * even with no group-bound tab left, so the author can clear the key `dashboardBuilderErrors`
 * refuses with `MIMIC_TAB_MESSAGE` on this field — hidden, that problem would block Save unseen.
 */
export function mimicTabSelectShown(row: MimicTabRow, tabs: readonly MimicTab[]): boolean {
  if (row.widgetType !== "mimic" || ownTabBindsGroup(row.tabKey, tabs)) {
    return false;
  }
  return tabs.some((tab) => tab.assetGroupId !== null) || row.config.mimicTabKey !== undefined;
}

/**
 * A new widget, once placed on its tab: a mimic on a tab with no group resolves through the first
 * group-bound tab by default, so a fresh mimic shows no scope problem. Any other row is unchanged.
 */
export function withDefaultMimicTabKey<Row extends MimicTabRow>(row: Row, tabs: readonly MimicTab[]): Row {
  if (row.widgetType !== "mimic" || row.config.mimicTabKey !== undefined || ownTabBindsGroup(row.tabKey, tabs)) {
    return row;
  }
  const first = tabs.find((tab) => tab.assetGroupId !== null);
  return first === undefined ? row : { ...row, config: { ...row.config, mimicTabKey: first.key } };
}

/**
 * The config a mimic row saves: a mimic on a group-bound tab resolves through that tab, so a
 * `mimicTabKey` left from an earlier tab is stale and is not written. A tab the list does not hold
 * keeps the key — the caller's tabs are the authority, and `[]` knows nothing.
 */
export function mimicConfigForSave(row: MimicTabRow, tabs: readonly MimicTab[]): WidgetConfigRow {
  if (row.config.mimicTabKey === undefined || !ownTabBindsGroup(row.tabKey, tabs)) {
    return row.config;
  }
  const { mimicTabKey: _stale, ...rest } = row.config;
  return rest;
}
