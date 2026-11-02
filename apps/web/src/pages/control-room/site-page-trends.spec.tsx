import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
 * `F4.302` U4 (ADR 0108 Amendment 4 items 1, 8) — the site page's third section, **Trends &
 * Energy** at `/trends`: rendered for every view kind once the resolve read has answered, exempt
 * from the `F3.70` D5 redirect, and never mounted for a site the resolve read refused. Kept out of
 * `site-page.spec.tsx` (911 lines) for the 1000-line cap, the `site-page-wall.spec.tsx`
 * precedent. Every body is a stand-in (each owns its suite); `fetch` is a spy and `cleanupTrends`
 * fails the case if anything reached it. Entry point: `site-page-trends.test.tsx`.
 */

vi.mock("../../components/control-room/site-trends-view", () => ({
  SiteTrendsView: ({ locationId }: { locationId: string }) => (
    <div data-testid="site-trends-view" data-location-id={locationId} />
  ),
}));
vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: () => <div data-testid="generated-site-view" />,
}));
vi.mock("../../components/control-room/smoc-site-view", () => ({
  SmocSiteView: () => <div data-testid="smoc-site-view" />,
}));
vi.mock("../../components/control-room/site-dashboard-view", () => ({
  SiteDashboardView: () => <div data-testid="site-dashboard-view" />,
}));
vi.mock("../../components/control-room/site-assets-view", () => ({
  SiteAssetsView: () => <div data-testid="site-assets-view" />,
}));
vi.mock("../../components/control-room/scoped-dashboards-list", () => ({
  ScopedDashboardsList: () => <div data-testid="scoped-dashboards-list" />,
}));
vi.mock("../../api/trend-strip", () => ({
  fetchSiteTrendStrip: () => new Promise(() => undefined),
}));

const ORG_ESKOM = { id: "org-eskom", code: "ESKOM", name: "Eskom" };
const SITES: LocationKpiSummary[] = [
  site({ id: "a1", name: "Alpha One", organization: ORG_A }),
  site({ id: "s1", name: "SMOC Campus", code: "RSMOC-WC", organization: ORG_ESKOM }),
];

function view(locationId: string, fields: Partial<ResolvedSiteControlRoomViewDto> = {}): ResolvedSiteControlRoomViewDto {
  return { locationId, kind: "generated", dashboardId: null, dashboardSlug: null, builtinKey: null, notice: null, ...fields };
}

let fetchSpy: Mock | null = null;

function stubReads(answer: ResolvedSiteControlRoomViewDto | "reject"): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: SITES });
  const resolve = vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView");
  if (answer === "reject") {
    resolve.mockRejectedValue(new Error("control-room/site-view 404"));
  } else {
    resolve.mockResolvedValue(answer);
  }
}

function PathnameProbe() {
  return <p data-testid="pathname">{useLocation().pathname}</p>;
}

function renderAt(path: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PathnameProbe />
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={USER} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

export function cleanupTrends(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}

/** T1 — three entries; at `/trends` "Trends & Energy" is current and links to the section. */
export async function theStripHasThreeEntriesWithTrendsCurrent(): Promise<void> {
  stubReads(view("a1"));
  renderAt("/control-room/site/a1/trends");
  const strip = await screen.findByRole("navigation", { name: "Site sections" });
  expect(
    within(strip)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]),
  ).toEqual([
    ["Site view", "/control-room/site/a1", null],
    ["Assets & RTUs", "/control-room/site/a1/assets", null],
    ["Trends & Energy", "/control-room/site/a1/trends", "page"],
  ]);
}

/** T2 — at the bare path "Site view" is current and "Trends & Energy" is not. */
export async function atTheBarePathSiteViewIsCurrent(): Promise<void> {
  stubReads(view("a1"));
  renderAt("/control-room/site/a1");
  const strip = await screen.findByRole("navigation", { name: "Site sections" });
  expect([
    within(strip).getByRole("link", { name: "Site view" }).getAttribute("aria-current"),
    within(strip).getByRole("link", { name: "Trends & Energy" }).getAttribute("aria-current"),
  ]).toEqual(["page", null]);
}

/** T3 — `/trends` on a `generated` site hosts the section, stays at the URL, mounts no site body. */
export async function aGeneratedSiteRendersTheSectionUnredirected(): Promise<void> {
  stubReads(view("a1"));
  renderAt("/control-room/site/a1/trends");
  expect(await screen.findByTestId("site-trends-view")).toHaveAttribute("data-location-id", "a1");
  expect(pathname()).toBe("/control-room/site/a1/trends");
  expect(screen.queryByTestId("generated-site-view")).toBeNull();
  expect(screen.queryByTestId("scoped-dashboards-list")).toBeNull();
}

/** T4 — `/trends` on a `dashboard` site hosts the section and no dashboard view. */
export async function aDashboardSiteRendersTheSection(): Promise<void> {
  stubReads(view("a1", { kind: "dashboard", dashboardId: "d1", dashboardSlug: "alpha" }));
  renderAt("/control-room/site/a1/trends");
  expect(await screen.findByTestId("site-trends-view")).toHaveAttribute("data-location-id", "a1");
  expect(pathname()).toBe("/control-room/site/a1/trends");
  expect(screen.queryByTestId("site-dashboard-view")).toBeNull();
}

/** T5 — `/trends` on the SMOC site hosts the section and no SMOC view. */
export async function theSmocSiteRendersTheSection(): Promise<void> {
  stubReads(view("s1", { kind: "builtin", builtinKey: "smoc" }));
  renderAt("/control-room/site/s1/trends");
  expect(await screen.findByTestId("site-trends-view")).toHaveAttribute("data-location-id", "s1");
  expect(pathname()).toBe("/control-room/site/s1/trends");
  expect(screen.queryByTestId("smoc-site-view")).toBeNull();
}

/** T6 — a rejected resolve read at `/trends` shows the not-available card and mounts no section. */
export async function aRejectedReadShowsTheCardAndNoSection(): Promise<void> {
  stubReads("reject");
  renderAt("/control-room/site/a1/trends");
  expect(await screen.findByText(/not available in your access scope/)).toBeInTheDocument();
  expect(pathname()).toBe("/control-room/site/a1/trends");
  expect(screen.queryByTestId("site-trends-view")).toBeNull();
}
