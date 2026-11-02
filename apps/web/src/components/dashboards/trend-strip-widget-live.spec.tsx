import type { DashboardWidgetDto, SiteTrendStripDto, TrendStripWidgetConfig } from "@bms/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { TREND_STRIP_NO_SITE_SENTENCE } from "../widgets/trend-strip-widget";
import { TrendStripWidgetLive, trendStripGroupFor, type TrendStripTabScope } from "./trend-strip-widget-live";

/**
 * `F4.305` U4 (ADR 0108 Amendment 3, item 2; plan call C1) — `TrendStripWidgetLive`: the widget's
 * `config.tabKey` resolves through the dashboard's own tabs to the group the read sends, and the
 * dashboard's location is the site. The api module is mocked; `fetch` is a rejecting spy, and
 * {@link cleanupTrendStripWidgetLive} fails the case if anything reached it.
 *
 * Assertions live here; `trend-strip-widget-live.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("../../api/trend-strip", () => ({ fetchSiteTrendStrip: vi.fn() }));

const fetchStrip = vi.mocked(fetchSiteTrendStrip);
let fetchSpy: ReturnType<typeof vi.fn> = vi.fn();

const LOCATION_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const GROUP_G = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const GROUP_H = "1a2b3c4d-5e6f-4a1b-9c8d-000000000002";

const TABS: readonly TrendStripTabScope[] = [
  { key: "overview", assetGroupId: null },
  { key: "hvac", assetGroupId: GROUP_G },
  { key: "ups", assetGroupId: GROUP_H },
  { key: "notes", assetGroupId: null },
];

function widget(config: TrendStripWidgetConfig): Extract<DashboardWidgetDto, { widgetType: "trend_strip" }> {
  return {
    id: "widget-ts",
    dashboardId: "dash-1",
    organizationId: "org-1",
    title: "Trends",
    gridX: 0,
    gridY: 2,
    gridW: 12,
    gridH: 4,
    points: [],
    sources: [],
    tabId: null,
    widgetType: "trend_strip",
    config,
  } as Extract<DashboardWidgetDto, { widgetType: "trend_strip" }>;
}

function strip(range: SiteTrendStripDto["range"]): SiteTrendStripDto {
  return {
    locationId: LOCATION_ID,
    assetGroupId: null,
    range,
    from: "2026-10-31T06:30:00.000Z",
    to: "2026-11-01T06:30:00.000Z",
    level: "5m",
    bucketSeconds: 1800,
    timeZone: "Asia/Kolkata",
    assetsPerPoint: 6,
    pointsPerSegment: 3,
    trimmed: false,
    segments: [],
  };
}

function renderLive(config: TrendStripWidgetConfig, locationId: string | null = LOCATION_ID): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("trend-strip-widget-live spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  fetchStrip.mockImplementation((_id, { range }) => Promise.resolve(strip(range)));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TrendStripWidgetLive widget={widget(config)} locationId={locationId} tabs={TABS} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Unmounts, restores the stubbed `fetch`, clears the mock, and fails the case on a raw read. */
export function cleanupTrendStripWidgetLive(): void {
  cleanup();
  const calls = fetchSpy.mock.calls.length;
  vi.unstubAllGlobals();
  fetchStrip.mockReset();
  expect(calls, "an unmocked read reached fetch").toBe(0);
}

/** A `tabKey` naming a group-bound tab sends that tab's group, at the dashboard's location. */
export async function aTabKeySendsThatTabsGroup(): Promise<void> {
  renderLive({ tabKey: "hvac", defaultRange: "24h" });
  await waitFor(() => expect(fetchStrip).toHaveBeenCalled());
  expect(fetchStrip.mock.calls[0]).toEqual([LOCATION_ID, { range: "24h", assetGroupId: GROUP_G }]);
}

/** No `tabKey` is the whole site: the read sends a null group. */
export async function noTabKeySendsTheWholeSite(): Promise<void> {
  renderLive({ defaultRange: "7d" });
  await waitFor(() => expect(fetchStrip).toHaveBeenCalled());
  expect(fetchStrip.mock.calls[0]).toEqual([LOCATION_ID, { range: "7d", assetGroupId: null }]);
}

/** A `tabKey` naming a tab with no group, or no tab at all, falls back to the whole site. */
export function aGroupLessOrUnknownTabResolvesToNull(): void {
  expect(trendStripGroupFor({ tabKey: "notes", defaultRange: "24h" }, TABS)).toBeNull();
  expect(trendStripGroupFor({ tabKey: "gone", defaultRange: "24h" }, TABS)).toBeNull();
  // The positive beside them: each group-bound tab resolves to its own group, not the first one.
  expect(trendStripGroupFor({ tabKey: "ups", defaultRange: "24h" }, TABS)).toBe(GROUP_H);
  expect(trendStripGroupFor({ tabKey: "hvac", defaultRange: "24h" }, TABS)).toBe(GROUP_G);
}

/** A dashboard with no location reads nothing and draws the fixed sentence. */
export async function noLocationReadsNothing(): Promise<void> {
  renderLive({ tabKey: "hvac", defaultRange: "24h" }, null);
  expect(screen.getByText(TREND_STRIP_NO_SITE_SENTENCE)).toBeInTheDocument();
  await Promise.resolve();
  expect(fetchStrip).not.toHaveBeenCalled();
}

/** The positive beside it: the same widget with a location reads once. */
export async function aLocationReadsOnce(): Promise<void> {
  renderLive({ tabKey: "hvac", defaultRange: "24h" });
  await waitFor(() => expect(fetchStrip).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(TREND_STRIP_NO_SITE_SENTENCE)).toBeNull();
}

/** A range click reads once more, with the new range and the same group. */
export async function aRangeClickReadsOnceMore(): Promise<void> {
  renderLive({ tabKey: "hvac", defaultRange: "24h" });
  await screen.findByText("No trend points for the assets on this tab.");
  expect(fetchStrip).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "7 d" }));
  await waitFor(() => expect(fetchStrip).toHaveBeenCalledTimes(2));
  expect(fetchStrip.mock.calls[1]).toEqual([LOCATION_ID, { range: "7d", assetGroupId: GROUP_G }]);
}
