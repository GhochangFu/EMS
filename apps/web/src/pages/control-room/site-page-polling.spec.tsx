import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as copilotApi from "../../api/copilot";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore } from "../../stores/auth-store";
import { ORG_A, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F4.390` (plan D6, Task 3.2) — how often the site page re-reads the site list. The page draws
 * only a name, an organization, `energyShown` and the crumbs from it, no live figure, so it polls
 * at 60 s; the other pages on the same key keep 8 s (owner ruling Q4). Kept out of
 * `site-page.spec.tsx` (long already), the `site-page-trends.spec.tsx` precedent. Every body is a
 * stand-in; `fetch` is a spy and the cleanup fails the case if anything reached it. Entry point:
 * `site-page-polling.test.tsx`.
 */

vi.mock("../../components/ml/ml-findings-card", () => ({ MlFindingsCard: () => null }));
vi.mock("../../components/asset-health/health-bad-actors-card", () => ({ HealthBadActorsCard: () => null }));
vi.mock("../../components/degradation/degradation-trend-card", () => ({ DegradationTrendCard: () => null }));
vi.mock("../../components/control-room/site-trends-view", () => ({ SiteTrendsView: () => null }));
vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: () => <div data-testid="generated-site-view" />,
}));
vi.mock("../../components/control-room/smoc-site-view", () => ({ SmocSiteView: () => null }));
vi.mock("../../components/control-room/site-dashboard-view", () => ({ SiteDashboardView: () => null }));
vi.mock("../../components/control-room/site-assets-view", () => ({ SiteAssetsView: () => null }));
vi.mock("../../components/control-room/scoped-dashboards-list", () => ({ ScopedDashboardsList: () => null }));
vi.mock("../../api/trend-strip", () => ({
  fetchSiteTrendStrip: () => new Promise(() => undefined),
}));

const SITES: LocationKpiSummary[] = [site({ id: "a1", name: "Alpha One", organization: ORG_A })];

let fetchSpy: Mock | null = null;

export function cleanupPolling(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}

/**
 * P1 — after render, the one observer of the site-list key on the site page polls at 60 s, and
 * its read was handed the query's abort signal. The page's own name is read first, so the options
 * are read from a mounted, answered page.
 */
export async function theSitePagePollsTheSiteListAtSixtySeconds(): Promise<void> {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: SITES });
  const view: ResolvedSiteControlRoomViewDto = {
    locationId: "a1",
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: null,
  };
  vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView").mockResolvedValue(view);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/control-room/site/a1"]}>
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={USER} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect((await screen.findAllByText("Alpha One")).length, "control: the page answered").toBeGreaterThan(0);

  const observers = queryClient.getQueryCache().find({ queryKey: ["dashboard", "locations"] })?.observers;
  expect(observers?.length, "control: the site list has an observer").toBeGreaterThan(0);
  expect(observers?.map((observer) => observer.options.refetchInterval)).toEqual([60_000]);
  // Task 3.1 on this page too: the query's abort signal reaches the fetcher (a `() => fetchLocationKpis()`
  // compiles and forwards none, so leaving the page would not abort the read).
  expect(locationsApi.fetchLocationKpis).toHaveBeenCalledWith(expect.any(AbortSignal));
}
