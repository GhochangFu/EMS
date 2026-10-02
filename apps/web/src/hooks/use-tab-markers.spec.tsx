import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi, type MockInstance } from "vitest";

import type { SiteWidgetTab, SiteWidgetsResponse } from "@bms/shared";

import * as siteWidgetsApi from "../api/dashboard-site-widgets";
import * as vocabulariesApi from "../api/vocabularies";
import { firstStoredTabKey, useTabMarkers } from "./use-tab-markers";

/**
 * `F3.77` (plan D4, ADR 0087 Amendment 3 ruling 5) — the tab markers read the existing
 * `tabs[]` of the site-widgets read, keyed on the dashboard's first stored tab, so the entry is the
 * one the Overview widgets already mount. A null key reads nothing. `use-tab-markers.test.tsx` is
 * the Vitest entry point. Both reads are spies: an unstubbed read would reach the API on :4000.
 */

const DASHBOARD_ID = "11111111-1111-4111-8111-111111111111";

function groupTab(tabKey: string, status: SiteWidgetTab["status"]): SiteWidgetTab {
  return { tabKey, label: tabKey.toUpperCase(), assetGroupId: "22222222-2222-4222-8222-222222222222", status };
}

const ANSWER: SiteWidgetsResponse = {
  dashboardId: DASHBOARD_ID,
  tabKey: "overview",
  resolvedAt: "2026-10-01T10:00:00.000Z",
  scope: { assetCount: 4 },
  alarms: { active: [], summary: [] },
  roles: [],
  breakers: [],
  stateMaps: [],
  tabs: [
    groupTab("hvac", { worstSeverity: "warning", tone: "warning", activeAlarms: 2, offlineAssets: 0, assets: 4 }),
    groupTab("env", null),
  ],
};

function stubReads(): { siteWidgets: MockInstance; vocabularies: MockInstance } {
  return {
    siteWidgets: vi.spyOn(siteWidgetsApi, "fetchSiteWidgets").mockResolvedValue(ANSWER),
    vocabularies: vi.spyOn(vocabulariesApi, "fetchVocabularies").mockResolvedValue({ alarmSeverities: [] } as never),
  };
}

function mount(tabKey: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useTabMarkers(DASHBOARD_ID, tabKey), { wrapper });
}

/** A null key (no stored tab) reads nothing: neither the site widgets nor the vocabulary. The
 * settle lets a read start before the absence is checked. Mutation: drop `enabled` => red. */
export async function aNullKeyMakesNoRequest(): Promise<void> {
  const reads = stubReads();
  const { result } = mount(null);
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(reads.siteWidgets).not.toHaveBeenCalled();
  expect(reads.vocabularies).not.toHaveBeenCalled();
  expect(result.current.byTab.size).toBe(0);
}

/** Positive control: a key reads the site widgets with that key — the Overview's own entry. */
export async function aKeyReadsTheSiteWidgetsOfThatTab(): Promise<void> {
  const reads = stubReads();
  mount("overview");
  await waitFor(() => expect(reads.siteWidgets).toHaveBeenCalled());
  expect(reads.siteWidgets.mock.calls.map((call) => [call[0], call[1]])).toEqual([[DASHBOARD_ID, "overview"]]);
}

/** The map holds the group tabs of `tabs[]` only, by key — the Overview is never one of them. */
export async function theMapHoldsTheGroupTabsOnly(): Promise<void> {
  stubReads();
  const { result } = mount("overview");
  await waitFor(() => expect(result.current.byTab.size).toBeGreaterThan(0));
  expect([...result.current.byTab.keys()]).toEqual(["hvac", "env"]);
  expect(result.current.byTab.get("env")?.status).toBeNull();
}

/** The key is the first stored tab by `sortOrder`, not by array order; none for no tab. */
export function theFirstStoredTabIsBySortOrder(): void {
  expect(
    firstStoredTabKey([
      { key: "sld", sortOrder: 1 },
      { key: "overview", sortOrder: 0 },
    ]),
  ).toBe("overview");
  expect(firstStoredTabKey([])).toBeNull();
}
