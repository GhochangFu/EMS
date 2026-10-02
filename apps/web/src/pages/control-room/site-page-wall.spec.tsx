import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as dashboardsApi from "../../api/dashboards";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore } from "../../stores/auth-store";
import { ORG_A, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D8, owner rulings OQ2 and OQ3) — the site page's
 * wall branch: `?wall=1` on a `dashboard` view renders `WallFrame` instead of `AppShell`, any other
 * view (or the assets tab) renders the normal page, and the header's **Wall** link shows only on a
 * `dashboard` view.
 *
 * Kept out of `site-page.spec.tsx` (903 lines) for the 1000-line cap, the
 * `site-page-site-layout.spec.tsx` precedent. `SiteDashboardView` is a stand-in that prints the
 * tab it was handed (its own suite owns its tabs); `GeneratedSiteView`, `SiteAssetsView` and
 * `ScopedDashboardsList` are stand-ins too. `fetch` is a spy and `cleanupWall` fails the case if anything reached it.
 */
vi.mock("../../components/control-room/site-dashboard-view", () => ({
  SiteDashboardView: ({ slug, tab }: { slug: string; tab: string | undefined }) => (
    <div data-testid="site-dashboard-view" data-slug={slug} data-tab={tab ?? ""} />
  ),
}));

vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: () => <div data-testid="generated-site-view" />,
}));

vi.mock("../../components/control-room/site-assets-view", () => ({
  SiteAssetsView: () => <div data-testid="site-assets-view" />,
}));

vi.mock("../../components/control-room/scoped-dashboards-list", () => ({
  ScopedDashboardsList: () => <div data-testid="scoped-dashboards-list" />,
}));

const LOCATION_ID = "p1";
const SITE_PATH = `/control-room/site/${LOCATION_ID}`;
const SLUG = "site-layout-lotapata";
const SITE: LocationKpiSummary = site({ id: LOCATION_ID, name: "Lotapata", organization: ORG_A });

const DASHBOARD_VIEW: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "dashboard",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  dashboardSlug: SLUG,
  builtinKey: null,
  notice: null,
};

const GENERATED_VIEW: ResolvedSiteControlRoomViewDto = {
  ...DASHBOARD_VIEW,
  kind: "generated",
  dashboardId: null,
  dashboardSlug: null,
};

/**
 * The dashboard's tabs, stored out of `sortOrder` order: unsorted, the tab after `overview` would
 * be `hvac`; by `sortOrder` it is `sld`. The rotation must sort them.
 */
function tabbedDashboard(): DashboardDto {
  const tab = (key: string, sortOrder: number) => ({
    id: `tab-${key}`,
    dashboardId: DASHBOARD_VIEW.dashboardId as string,
    organizationId: ORG_A.id,
    key,
    label: key.toUpperCase(),
    sortOrder,
    assetGroupId: null,
  });
  return {
    id: DASHBOARD_VIEW.dashboardId as string,
    organizationId: ORG_A.id,
    slug: SLUG,
    name: "Lotapata",
    description: null,
    locationId: LOCATION_ID,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: null,
    tabs: [tab("overview", 0), tab("hvac", 2), tab("sld", 1)],
    widgets: [],
  };
}

let fetchSpy: Mock | null = null;
let dashboardRead: Mock | null = null;

function stubReads(view: ResolvedSiteControlRoomViewDto): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [SITE] });
  vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView").mockResolvedValue(view);
  dashboardRead = vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(tabbedDashboard()) as unknown as Mock;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderPage(entry: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/control-room/site/:locationId/:tab?"
            element={
              <>
                <ControlRoomSitePage user={USER} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Unmounts, restores the stubs, and fails the case if any read reached the network. */
export function cleanupWall(): void {
  cleanup();
  vi.useRealTimers();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  dashboardRead = null;
  useAuthStore.setState({ scope: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(networkCalls, "a read reached the network").toEqual([]);
}

/** P1 — `?wall=1` on a `dashboard` view renders the wall frame around the site's dashboard, not the shell. */
export async function wallOnADashboardViewRendersTheFrame(): Promise<void> {
  stubReads(DASHBOARD_VIEW);
  renderPage(`${SITE_PATH}/sld?wall=1&every=30`);
  expect(await screen.findByRole("link", { name: "Exit wall" })).toHaveAttribute("href", `${SITE_PATH}/sld`);
  expect(screen.getByRole("heading", { level: 1, name: "Lotapata" })).toBeInTheDocument();
  expect(screen.getByTestId("site-dashboard-view")).toHaveAttribute("data-tab", "sld");
  expect(screen.queryAllByRole("banner")).toEqual([]);
  expect(screen.queryByRole("contentinfo")).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Site sections" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Wall" })).toBeNull();
}

/** P2 — `?wall=1` on a `generated` view renders the normal page (OQ3). */
export async function wallOnAGeneratedViewRendersTheNormalPage(): Promise<void> {
  stubReads(GENERATED_VIEW);
  renderPage(`${SITE_PATH}?wall=1&every=30`);
  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo"), "the shell's footer").toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Exit wall" })).toBeNull();
}

/** P3 — `?wall=1` on the assets tab renders the normal page: the wall shows the dashboard only. */
export async function wallOnTheAssetsTabRendersTheNormalPage(): Promise<void> {
  stubReads(DASHBOARD_VIEW);
  renderPage(`${SITE_PATH}/assets?wall=1&every=30`);
  expect(await screen.findByTestId("site-assets-view")).toBeInTheDocument();
  expect(screen.getByRole("contentinfo"), "the shell's footer").toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Exit wall" })).toBeNull();
}

/** P4 — on a `dashboard` view the header's Wall link carries the tab and `?wall=1&every=30`. */
export async function theWallLinkCarriesTheTabAndTheDefaults(): Promise<void> {
  stubReads(DASHBOARD_VIEW);
  renderPage(`${SITE_PATH}/sld`);
  expect(await screen.findByRole("link", { name: "Wall" })).toHaveAttribute(
    "href",
    `${SITE_PATH}/sld?wall=1&every=30`,
  );
}

/** P5 — at the bare path the Wall link is the bare path with the defaults. */
export async function theWallLinkAtTheBarePath(): Promise<void> {
  stubReads(DASHBOARD_VIEW);
  renderPage(SITE_PATH);
  expect(await screen.findByRole("link", { name: "Wall" })).toHaveAttribute("href", `${SITE_PATH}?wall=1&every=30`);
}

/** P6 — no Wall link on a `generated` view (OQ3). */
export async function noWallLinkOnAGeneratedView(): Promise<void> {
  stubReads(GENERATED_VIEW);
  renderPage(SITE_PATH);
  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Lotapata" }), "control: the header rendered").toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Wall" })).toBeNull();
}

/** P7 — the wall rotates through the dashboard's tabs by `sortOrder`, read with the viewer's key. */
export async function theWallRotatesByTheDashboardsTabOrder(): Promise<void> {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  stubReads(DASHBOARD_VIEW);
  renderPage(`${SITE_PATH}/overview?wall=1&every=15`);
  await screen.findByRole("link", { name: "Exit wall" });
  await waitFor(() => {
    expect(dashboardRead).toHaveBeenCalledWith(SLUG, ORG_A.id);
  });
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(screen.getByTestId("location").textContent).toBe(`${SITE_PATH}/sld?wall=1&every=15`);
}
