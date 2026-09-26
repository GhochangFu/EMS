import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as dashboardsApi from "../../api/dashboards";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import { siteViewNoticeText } from "../../lib/site-view-notice";
import { useAuthStore } from "../../stores/auth-store";
import { ORG_A, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F3.69` U3 — the key binding between `SiteDashboardView`'s `Try again` and
 * the site page's own resolve read. `SITE_VIEW_RESOLVE_PREFIX`
 * (`site-dashboard-view.tsx`) is copied by hand from the page's inline key
 * `["control-room", "site-view", locationId]` (`site-page.tsx`); nothing in
 * the type system binds the two together, so this suite renders the real
 * page and the real `SiteDashboardView` and proves a click on `Try again`
 * actually reaches the page's own resolve read (owner ruling OQ2 (a)).
 *
 * Kept in its own file, separate from `site-page.spec.tsx`, so it does not
 * collide with `F3.70`'s edits there. `DashboardLiveCanvas` is mocked by
 * module (`F3.69` U1 proves it); `GeneratedSiteView` is mocked the way
 * `site-page.spec.tsx` does, since the fail-safe path (R2) falls back to it.
 * `fetch` itself is a spy and `cleanupRetry` fails the case if anything
 * reached it, the same pattern as `site-page.spec.tsx`.
 */
vi.mock("../../components/dashboards/dashboard-live-canvas", () => ({
  DashboardLiveCanvas: ({ dashboard }: { dashboard: DashboardDto }) => (
    <div data-testid="dashboard-live-canvas" data-dashboard-id={dashboard.id} />
  ),
}));

vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: ({ locationId }: { locationId: string }) => (
    <div data-testid="generated-site-view" data-location-id={locationId} />
  ),
}));

const SLUG = "phe-lotapata";
const LOCATION_ID = "p1";

const PHE_SITE: LocationKpiSummary = site({ id: LOCATION_ID, name: "Lotapata", organization: ORG_A });

function notFound(): ApiError {
  return new ApiError('{"message":"Dashboard not found","statusCode":404}', 404);
}

const DASHBOARD_VIEW: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "dashboard",
  dashboardId: "d1",
  dashboardSlug: SLUG,
  builtinKey: null,
  notice: null,
};

const GENERATED_REMOVED: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "generated",
  dashboardId: null,
  dashboardSlug: null,
  builtinKey: null,
  notice: "dashboard_removed",
};

let fetchSpy: Mock | null = null;

/**
 * Stubs the shell reads, the KPI list and the resolve read (returning
 * `resolveAnswers` in order, the last repeated for any further call — a
 * persistent mock, since `Try again` always calls both reads). `fetchDashboard`
 * always rejects with a 404 until swapped by the caller, so it never falls
 * through to the real client after a `mockRejectedValueOnce` queue empties.
 */
function stubReads(...resolveAnswers: ResolvedSiteControlRoomViewDto[]): {
  resolve: Mock;
  dashboard: Mock;
} {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [PHE_SITE] });

  const resolve = vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView");
  for (const answer of resolveAnswers) {
    resolve.mockResolvedValueOnce(answer);
  }
  resolve.mockResolvedValue(resolveAnswers[resolveAnswers.length - 1]);

  const dashboard = vi.spyOn(dashboardsApi, "fetchDashboard").mockRejectedValue(notFound());

  return { resolve: resolve as unknown as Mock, dashboard: dashboard as unknown as Mock };
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/control-room/site/${LOCATION_ID}`]}>
        <Routes>
          <Route path="/control-room/site/:locationId" element={<ControlRoomSitePage user={USER} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/**
 * Renders the page (resolve answers `dashboard`), waits for the failed
 * dashboard read's alert, and clicks `Try again`. Returns the resolve spy so
 * callers assert on its call count.
 */
async function renderFailClickTryAgain(): Promise<Mock> {
  const { resolve } = stubReads(DASHBOARD_VIEW);
  renderPage();

  await screen.findByRole("alert");
  // Positive control: the click, not the initial mount, is what calls resolve
  // a second time.
  expect(resolve).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

  return resolve;
}

/** R1 — the click reaches the page's own resolve read: it is called a second time. */
export async function tryAgainCallsTheResolveReadTwice(): Promise<void> {
  const resolve = await renderFailClickTryAgain();

  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
}

/**
 * R2 — the end-to-end fail-safe path (owner ruling OQ2 (a)): when the second
 * resolve answer is `generated` / `dashboard_removed`, the page shows the
 * notice banner and the generated view.
 */
export async function tryAgainShowsTheFailSafeOnRemoval(): Promise<void> {
  stubReads(DASHBOARD_VIEW, GENERATED_REMOVED);
  renderPage();

  await screen.findByRole("alert");
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

  const banner = await screen.findByTestId("site-view-notice");
  expect([banner.textContent, screen.queryByTestId("generated-site-view") !== null]).toEqual([
    siteViewNoticeText("dashboard_removed"),
    true,
  ]);
}

/** Unmounts, restores the spies and fails the case if any read reached the network. */
export function cleanupRetry(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}
