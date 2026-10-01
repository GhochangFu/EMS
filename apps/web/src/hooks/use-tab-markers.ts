import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AlarmSeverityDto, SiteWidgetTab } from "@bms/shared";

import { fetchVocabularies, vocabulariesQueryKey } from "../api/vocabularies";
import { useSiteWidgets } from "./use-site-widgets";

/**
 * The status of each marked tab by key, and the severity vocabulary that names it. A tab absent
 * from `byTab` draws no marker.
 */
export type TabMarkers = {
  readonly byTab: ReadonlyMap<string, SiteWidgetTab>;
  readonly severities: readonly AlarmSeverityDto[];
};

const NO_SEVERITIES: readonly AlarmSeverityDto[] = [];

/** The key of a dashboard's first stored tab by `sortOrder` — the markers' read key — or null. */
export function firstStoredTabKey(tabs: readonly { key: string; sortOrder: number }[]): string | null {
  let first: { key: string; sortOrder: number } | undefined;
  for (const tab of tabs) {
    if (first === undefined || tab.sortOrder < first.sortOrder) {
      first = tab;
    }
  }
  return first?.key ?? null;
}

/**
 * `F3.77` (plan D4, ADR 0087 Amendment 3 ruling 5) — the tab markers of one dashboard, from the
 * `tabs[]` the existing site-widgets read already returns for every group tab. No new endpoint.
 *
 * `tabKey` is the dashboard's first stored tab ({@link firstStoredTabKey}) — the Overview on a site
 * layout — so the read is the very cache entry the Overview widgets mount, and a tab switch never
 * re-reads or flickers the markers. A null key (a dashboard with no stored tab) reads nothing: not
 * the site widgets, not the vocabulary.
 *
 * The map holds what `tabs[]` lists — the group tabs only — so the Overview and any tab with no
 * group draw no marker by construction. Before the read answers (or after it failed with no
 * answer) the map is empty: no marker, never a zero. A tab whose members the caller cannot read is
 * listed with `status` null, and its marker says "Outside scope".
 */
export function useTabMarkers(dashboardId: string, tabKey: string | null): TabMarkers {
  const enabled = tabKey !== null;
  const query = useSiteWidgets(dashboardId, tabKey, { enabled });
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
  const tabs = query.data?.tabs;
  const byTab = useMemo(() => new Map((tabs ?? []).map((tab) => [tab.tabKey, tab])), [tabs]);
  return { byTab, severities: vocabQ.data?.alarmSeverities ?? NO_SEVERITIES };
}
