import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as copilotApi from "../../api/copilot";
import * as dashboardsApi from "../../api/dashboards";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore } from "../../stores/auth-store";
import { ORG_A, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `E1.8c` (ADR 0050 Amendment 5, plan T3.2, owner ruling Q2 (a)) — the site page draws the *Bad
 * actors* card on the site view body, scoped to the site and its organization and with the site's
 * count line inside it (`showCount`: the site page has no donut), after `E1.9e`'s findings card
 * and before the site's dashboards. It is not drawn on the wall, on the assets tab, on the trends
 * tab, or before the site view read has answered.
 *
 * `HealthBadActorsCard` is a stand-in that prints the props the page passes (its read, tabs and
 * states are gated by `health-bad-actors-card.spec.tsx`); the findings card and the site views are
 * stand-ins too. `fetch` is a spy and `cleanupBadActors` fails the case if anything reached it.
 * Kept out of `site-page.spec.tsx` for the 1000-line cap, the `site-page-ml-findings.spec.tsx`
 * precedent. Entry point: `site-page-bad-actors.test.tsx`.
 */
vi.mock("../../components/asset-health/health-bad-actors-card", () => ({
  HealthBadActorsCard: ({
    organizationId,
    locationId,
    showCount,
  }: {
    organizationId?: string;
    locationId?: string;
    showCount?: boolean;
  }) => (
    <div
      data-testid="bad-actors-card"
      data-organization-id={organizationId}
      data-location-id={locationId}
      data-show-count={String(showCount ?? "(absent)")}
    />
  ),
}));

vi.mock("../../components/ml/ml-findings-card", () => ({
  MlFindingsCard: () => <div data-testid="ml-findings-card" />,
}));

vi.mock("../../components/control-room/site-dashboard-view", () => ({
  SiteDashboardView: ({ wall }: { wall?: boolean }) => (
    <div data-testid="site-dashboard-view" data-wall={String(wall ?? false)} />
  ),
}));

vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: () => <div data-testid="generated-site-view" />,
}));

vi.mock("../../components/control-room/smoc-site-view", () => ({
  SmocSiteView: () => <div data-testid="smoc-site-view" />,
}));

vi.mock("../../components/control-room/site-assets-view", () => ({
  SiteAssetsView: () => <div data-testid="site-assets-view" />,
}));

vi.mock("../../components/control-room/site-trends-view", () => ({
  SiteTrendsView: () => <div data-testid="site-trends-view" />,
}));

vi.mock("../../components/control-room/scoped-dashboards-list", () => ({
  ScopedDashboardsList: () => <div data-testid="scoped-dashboards-list" />,
}));

vi.mock("../../components/control-room/replace-site-layout-wizard", () => ({
  ReplaceSiteLayoutWizard: () => null,
}));

vi.mock("../../api/trend-strip", () => ({
  fetchSiteTrendStrip: () => new Promise(() => undefined),
}));

const LOCATION_ID = "m1";
const SITE_PATH = `/control-room/site/${LOCATION_ID}`;
const SLUG = "site-layout-marlow";
const SITE: LocationKpiSummary = site({ id: LOCATION_ID, name: "Marlow Works", organization: ORG_A });

const GENERATED_VIEW: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "generated",
  dashboardId: null,
  dashboardSlug: null,
  builtinKey: null,
  notice: null,
};

const DASHBOARD_VIEW: ResolvedSiteControlRoomViewDto = {
  ...GENERATED_VIEW,
  kind: "dashboard",
  dashboardId: "33333333-3333-4333-8333-333333333333",
  dashboardSlug: SLUG,
};

function oneTabDashboard(): DashboardDto {
  return {
    id: DASHBOARD_VIEW.dashboardId as string,
    organizationId: ORG_A.id,
    slug: SLUG,
    name: "Marlow Works",
    description: null,
    locationId: LOCATION_ID,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: null,
    tabs: [
      {
        id: "tab-overview",
        dashboardId: DASHBOARD_VIEW.dashboardId as string,
        organizationId: ORG_A.id,
        key: "overview",
        label: "Overview",
        sortOrder: 0,
        assetGroupId: null,
      },
    ],
    widgets: [],
  };
}

let fetchSpy: Mock | null = null;

/** `view` is the resolve read's answer; `"pending"` never answers. */
function stubReads(view: ResolvedSiteControlRoomViewDto | "pending"): Mock {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({ assetDomains: [] } as never);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [SITE] });
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(oneTabDashboard());
  const resolve = vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView");
  if (view === "pending") {
    resolve.mockImplementation(() => new Promise(() => undefined));
  } else {
    resolve.mockResolvedValue(view);
  }
  return resolve as unknown as Mock;
}

function renderPage(entry: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={USER} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Unmounts, restores the stubs, and fails the case if any read reached the network. */
export function cleanupBadActors(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  useAuthStore.setState({ scope: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(networkCalls, "a read reached the network").toEqual([]);
}

/**
 * B1 — the site view body draws one card for the site and its organization, with `showCount`,
 * after the findings card and before the site's dashboards.
 */
export async function theBodyDrawsTheCardForTheSite(): Promise<void> {
  stubReads(GENERATED_VIEW);
  renderPage(SITE_PATH);

  const body = await screen.findByTestId("generated-site-view");
  const cards = screen.getAllByTestId("bad-actors-card");
  expect(cards).toHaveLength(1);
  const card = cards[0];
  expect(card.dataset.organizationId).toBe(ORG_A.id);
  expect(card.dataset.locationId).toBe(LOCATION_ID);
  expect(card.dataset.showCount).toBe("true");
  const findings = screen.getByTestId("ml-findings-card");
  expect(
    body.compareDocumentPosition(findings) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the findings card must follow the site view body",
  ).toBeTruthy();
  expect(findings.nextElementSibling, "the card directly follows the findings card").toBe(card);
  expect(card.nextElementSibling, "the site's dashboards follow the card").toBe(
    screen.getByTestId("scoped-dashboards-list"),
  );
}

/** B2 — a `dashboard` view off the wall draws the card: the control for B3. */
export async function aDashboardViewOffTheWallDrawsTheCard(): Promise<void> {
  stubReads(DASHBOARD_VIEW);
  renderPage(SITE_PATH);

  expect(await screen.findByTestId("site-dashboard-view")).toHaveAttribute("data-wall", "false");
  expect(screen.getAllByTestId("bad-actors-card")).toHaveLength(1);
}

/** B3 — the wall (`?wall=1` on a `dashboard` view) draws no card. */
export async function theWallDrawsNoCard(): Promise<void> {
  stubReads(DASHBOARD_VIEW);
  renderPage(`${SITE_PATH}?wall=1&every=30`);

  expect(await screen.findByRole("link", { name: "Exit wall" })).toBeInTheDocument();
  expect(screen.getByTestId("site-dashboard-view")).toHaveAttribute("data-wall", "true");
  expect(screen.queryByTestId("bad-actors-card")).toBeNull();
}

/** B4 — the Assets & RTUs tab draws no card. */
export async function theAssetsTabDrawsNoCard(): Promise<void> {
  stubReads(GENERATED_VIEW);
  renderPage(`${SITE_PATH}/assets`);

  expect(await screen.findByTestId("site-assets-view")).toBeInTheDocument();
  expect(screen.queryByTestId("bad-actors-card")).toBeNull();
}

/** B5 — the Trends tab draws no card. */
export async function theTrendsTabDrawsNoCard(): Promise<void> {
  stubReads(GENERATED_VIEW);
  renderPage(`${SITE_PATH}/trends`);

  expect(await screen.findByTestId("site-trends-view")).toBeInTheDocument();
  expect(screen.queryByTestId("bad-actors-card")).toBeNull();
}

/** B6 — no card before the site view read has answered. */
export async function aPendingSiteViewDrawsNoCard(): Promise<void> {
  const resolve = stubReads("pending");
  renderPage(SITE_PATH);

  expect(await screen.findByText("Loading the site view…")).toBeInTheDocument();
  await waitFor(() => expect(resolve).toHaveBeenCalled());
  expect(screen.queryByTestId("bad-actors-card")).toBeNull();
}
