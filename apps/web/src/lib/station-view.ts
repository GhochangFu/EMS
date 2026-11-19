import type { DashboardDto } from "@bms/shared";

import { SITE_ASSETS_TAB, SITE_TRENDS_TAB } from "./smoc-pages";

/** One entry of the station's tab chooser: a dashboard tab key and the label first seen for it. */
export type StationTab = { readonly key: string; readonly label: string };

/** The segments the site page owns itself; a dashboard tab with one of these keys is not offered. */
const PAGE_SEGMENTS: ReadonlySet<string> = new Set([SITE_ASSETS_TAB, SITE_TRENDS_TAB]);

/**
 * `F4.240` part b (ADR 0140 decision 3e, plan D8) — the station's tab chooser: the union of the
 * sites' dashboard tab keys, first seen wins. Sites come in the KPI list's order, and within a
 * site the tabs by `sortOrder`, so the first site's tabs lead and a key only a later site holds
 * comes after them, with the label of the first dashboard that holds it.
 *
 * `undefined` stands for a site with no dashboard to offer (its read is pending, failed, or its
 * view is not a `dashboard`) and adds nothing. The page's own segments (`assets`, `trends`) are
 * dropped, so the chooser never hides them. The bare station path selects the first entry.
 *
 * Tabs are matched by key only; no code names a key, a level or an organization (ADR 0098
 * decision 7). The cached DTOs are never reordered (the tabs are sorted as a copy).
 */
export function stationTabs(dashboards: readonly (Pick<DashboardDto, "tabs"> | undefined)[]): StationTab[] {
  const out: StationTab[] = [];
  const seen = new Set<string>();
  for (const dashboard of dashboards) {
    if (dashboard === undefined) {
      continue;
    }
    for (const entry of [...dashboard.tabs].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (seen.has(entry.key) || PAGE_SEGMENTS.has(entry.key)) {
        continue;
      }
      seen.add(entry.key);
      out.push({ key: entry.key, label: entry.label });
    }
  }
  return out;
}
