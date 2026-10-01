import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, SiteWidgetsResponse, UserRole } from "@bms/shared";

import * as dashboardsApi from "../api/dashboards";
import * as siteWidgetsApi from "../api/dashboard-site-widgets";
import * as vocabulariesApi from "../api/vocabularies";
import * as systemStatusApi from "../api/system-status";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import type { AuthUser } from "../stores/auth-store";
import { DashboardViewerPage } from "./dashboard-viewer-page";

/**
 * `F3.69` U1 DV1 — after the extraction, the viewer must still render a bound
 * widget through `DashboardLiveCanvas`. `socket.io-client` and
 * `../api/telemetry` are module mocks so a widget-bearing DTO does not open a
 * real socket or reach a real API from jsdom (precedent: `generated-site-view.spec.tsx`).
 */
const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  disconnect: vi.fn(),
  fetchTelemetryRecent: vi.fn(),
  fetchPointAggregate: vi.fn(),
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));

vi.mock("../api/telemetry", () => ({
  fetchTelemetryRecent: mocks.fetchTelemetryRecent,
  fetchPointAggregate: mocks.fetchPointAggregate,
}));

/**
 * `F3.1d` Unit 6 — the read-only dashboard detail.
 *
 * Assertions live here; `dashboard-viewer-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * **The load-bearing assertion in this file.** `F3.63`, ADR 0047 Amendment 6 —
 * `/admin/dashboards/:slug` is now wrapped in `DashboardAuthorRoute`, which guards on the same
 * `canAuthorDashboards` predicate as this link, so an `asset_group_admin` reaches the edit page
 * rather than a silent redirect. Seeded `wc-hvac-admin@bms.local` is this role.
 */

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: "22222222-2222-4222-8222-222222222222",
  slug: "site-a-overview",
  name: "Site A Overview",
  description: null,
  locationId: "loc-1",
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  templateId: null,
  tabs: [],
  widgets: [],
};

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const DTO_WITH_WIDGET: DashboardDto = {
  ...DTO,
  widgets: [
    {
      id: "widget-1",
      dashboardId: "dash-1",
      organizationId: "22222222-2222-4222-8222-222222222222",
      title: "Energy today",
      gridX: 0,
      gridY: 0,
      gridW: 4,
      gridH: 4,
      points: [
        {
          id: "point-1",
          pointId: "point-1",
          role: "primary",
          sortOrder: 0,
          assetId: ASSET_ID,
          assetCode: "AHU-01",
          pointKey: "kw",
          unit: "kWh",
        },
      ],
      sources: [],
      tabId: null,
      widgetType: "value_tile",
      config: { unit: "kWh", decimals: 2 },
    } as DashboardDto["widgets"][number],
  ],
};

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

/** Prints the router's search string and offers a Back, so a spec reads the URL the page wrote and
 * walks the history the way the browser's Back button does. */
function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location-search">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Probe back
      </button>
    </>
  );
}

function renderPage(user: AuthUser, entry = "/dashboards/site-a-overview"): void {
  // `AppShell` mounts `SystemStatusIndicator`; unstubbed, its `GET /system/status` reaches a local
  // API on :4000, answers 401 and clears the session (`dashboard-builder-page.spec.tsx`'s precedent).
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/dashboards/:slug"
            element={
              <>
                <DashboardViewerPage user={user} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const searchParams = () => new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");

export async function assetGroupAdminSeesTheEditLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  renderPage(asUser("asset_group_admin"));

  expect(await screen.findByRole("heading", { name: "Site A Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Edit dashboard/i })).toBeInTheDocument();
}

export async function aLocationAdminStillSeesTheEditLink(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO);
  renderPage(asUser("location_admin"));

  expect(await screen.findByRole("heading", { name: "Site A Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Edit dashboard/i })).toBeInTheDocument();
}

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const TAB_POWER_ID = "33333333-3333-4333-8333-333333333331";
const TAB_HVAC_ID = "33333333-3333-4333-8333-333333333332";

function widgetOn(id: string, title: string, tabId: string | null): DashboardDto["widgets"][number] {
  return { ...DTO_WITH_WIDGET.widgets[0], id, title, tabId } as DashboardDto["widgets"][number];
}

/** `F3.73` (plan D11) — a site-layout copy: two tabs, listed out of `sortOrder` so the default
 * selection is proved to read `sortOrder` rather than array order. */
const DTO_WITH_TABS: DashboardDto = {
  ...DTO,
  tabs: [
    { id: TAB_HVAC_ID, dashboardId: "dash-1", organizationId: ORG_ID, key: "hvac", label: "HVAC", sortOrder: 1, assetGroupId: null },
    { id: TAB_POWER_ID, dashboardId: "dash-1", organizationId: ORG_ID, key: "power", label: "Power", sortOrder: 0, assetGroupId: null },
  ],
  widgets: [widgetOn("widget-power", "Power tile", TAB_POWER_ID), widgetOn("widget-hvac", "HVAC tile", TAB_HVAC_ID)],
};

function stubLiveCanvas(): void {
  mocks.io.mockImplementation(() => ({ on: vi.fn(), disconnect: mocks.disconnect }));
  mocks.fetchTelemetryRecent.mockResolvedValue([]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
}

/** `F3.73` D11 — a tabbed dashboard shows the tab strip, the first tab by `sortOrder` selected. */
export async function aTabbedDashboardShowsTheStripWithTheFirstTabSelected(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"));

  const strip = await screen.findByRole("tablist", { name: "Dashboard tabs" });
  expect(within(strip).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Power", "HVAC"]);
  expect(within(strip).getByRole("tab", { name: "Power" })).toHaveAttribute("aria-selected", "true");
}

/** `F3.73` D11 — only the selected tab's widgets render, so two tabs' tiles never share one grid.
 * Mutation: drop `tabKey` from the viewer's `DashboardLiveCanvas` => red. */
export async function aTabbedDashboardRendersOnlyTheSelectedTabsWidgets(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"));

  expect(await screen.findByText("Power tile")).toBeInTheDocument();
  expect(screen.queryByText("HVAC tile")).not.toBeInTheDocument();
}

/** `F3.73` D11 — selecting another tab swaps the canvas to that tab's widgets. */
export async function switchingTabsSwapsTheWidgets(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"));

  await screen.findByText("Power tile");
  await userEvent.click(screen.getByRole("tab", { name: "HVAC" }));

  expect(await screen.findByText("HVAC tile")).toBeInTheDocument();
  expect(screen.queryByText("Power tile")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "HVAC" })).toHaveAttribute("aria-selected", "true");
}

/** `F3.73` D11 — a dashboard with no tabs shows no strip and still renders its widgets. */
export async function anUntabbedDashboardShowsNoStrip(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_WIDGET);
  renderPage(asUser("asset_group_admin"));

  expect(await screen.findByText("Energy today")).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
}

/** `F3.73` critique fix — the selected tab lives in the URL (`?tab=<key>`), so a reload or a shared
 * link opens it. Mutation: read the selection from local state, not the search => red. */
export async function aTabInTheUrlIsSelectedOnLoad(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"), "/dashboards/site-a-overview?tab=hvac");

  expect(await screen.findByText("HVAC tile")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "HVAC" })).toHaveAttribute("aria-selected", "true");
}

/** An unknown `?tab=` key opens the first tab by `sortOrder`. Mutation: render no canvas for an
 * unknown key => red. */
export async function anUnknownTabKeyOpensTheFirstTab(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"), "/dashboards/site-a-overview?tab=nope");

  expect(await screen.findByText("Power tile")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Power" })).toHaveAttribute("aria-selected", "true");
}

/** The first load writes no `?tab=`: the default tab needs none. The settle lets an effect's write
 * reach the probe before the absence is read. Mutation: a mount effect that writes the default tab
 * => red. */
export async function aFirstLoadWritesNoTabParam(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"), `/dashboards/site-a-overview?organizationId=${ORG_ID}`);

  await screen.findByText("Power tile");
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(screen.getByRole("tab", { name: "Power" })).toHaveAttribute("aria-selected", "true");
  expect(Object.fromEntries(searchParams())).toEqual({ organizationId: ORG_ID });
}

/** Selecting a tab writes `?tab=` and keeps `organizationId` (the slug's disambiguator). Mutation:
 * write a fresh search with `tab` only => red. */
export async function selectingATabWritesItKeepingOrganizationId(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"), `/dashboards/site-a-overview?organizationId=${ORG_ID}`);

  await screen.findByText("Power tile");
  await userEvent.click(screen.getByRole("tab", { name: "HVAC" }));

  expect(Object.fromEntries(searchParams())).toEqual({ organizationId: ORG_ID, tab: "hvac" });
}

/** Back returns to the previous tab: a selection is a history entry. Mutation: write the search
 * with `replace: true` => red. */
export async function backReturnsToThePreviousTab(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"));

  await screen.findByText("Power tile");
  await userEvent.click(screen.getByRole("tab", { name: "HVAC" }));
  await screen.findByText("HVAC tile");
  await userEvent.click(screen.getByRole("button", { name: "Probe back" }));

  expect(await screen.findByText("Power tile")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Power" })).toHaveAttribute("aria-selected", "true");
}

/**
 * Critique fix — a module card in the viewer opens its tab: its link is the viewer's own `?tab=`
 * (keeping `organizationId`), and following it selects that tab. Mutation: drop the viewer's
 * `SiteTabHrefContext` provider => the card draws no link => red.
 */
export async function aModuleCardInTheViewerOpensItsTab(): Promise<void> {
  stubLiveCanvas();
  const card = {
    ...widgetOn("widget-card", "HVAC card", TAB_POWER_ID),
    widgetType: "module_summary_card",
    config: { targetTabKey: "hvac" },
    points: [],
  } as unknown as DashboardDto["widgets"][number];
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue({ ...DTO_WITH_TABS, widgets: [...DTO_WITH_TABS.widgets, card] });
  const answer: SiteWidgetsResponse = {
    dashboardId: "dash-1",
    tabKey: "power",
    resolvedAt: "2026-10-01T10:00:00.000Z",
    scope: { assetCount: 0 },
    alarms: { active: [], summary: [] },
    roles: [],
    tabs: [{ tabKey: "hvac", label: "HVAC", assetGroupId: null, status: null }],
  } as unknown as SiteWidgetsResponse;
  vi.spyOn(siteWidgetsApi, "fetchSiteWidgets").mockResolvedValue(answer);
  vi.spyOn(vocabulariesApi, "fetchVocabularies").mockResolvedValue({ alarmSeverities: [] } as never);
  renderPage(asUser("asset_group_admin"), `/dashboards/site-a-overview?organizationId=${ORG_ID}`);

  const link = await screen.findByRole("link", { name: "Open HVAC" });
  expect(link.getAttribute("href")).toBe(`/dashboards/site-a-overview?organizationId=${ORG_ID}&tab=hvac`);
  await userEvent.click(link);
  expect(await screen.findByText("HVAC tile")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "HVAC" })).toHaveAttribute("aria-selected", "true");
}

/**
 * A run of arrow-key moves is one history entry: open on HVAC, click Power (an entry), then
 * ArrowRight to HVAC (the run's entry) and ArrowLeft to Power (replaced). One Back lands on Power,
 * where the run started. Mutations: push every key move => Back lands on HVAC => red; replace
 * every key move (the first one too) => Back lands on the opening HVAC => red.
 */
export async function anArrowKeyMoveReplacesTheHistoryEntry(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"), "/dashboards/site-a-overview?tab=hvac");

  await screen.findByText("HVAC tile");
  await userEvent.click(screen.getByRole("tab", { name: "Power" }));
  await screen.findByText("Power tile");
  await userEvent.keyboard("{ArrowRight}");
  await screen.findByText("HVAC tile");
  await userEvent.keyboard("{ArrowLeft}");
  await screen.findByText("Power tile");
  expect(searchParams().get("tab")).toBe("power");
  await userEvent.click(screen.getByRole("button", { name: "Probe back" }));

  expect(await screen.findByText("Power tile")).toBeInTheDocument();
  expect(searchParams().get("tab")).toBe("power");
  expect(screen.queryByText("HVAC tile")).toBeNull();
}

/** The widget titles are `h3`; the tab panel carries the `h2` between them and the page's `h1`,
 * named by the selected tab. Mutation: drop the panel heading => red. */
export async function aTabbedViewerHasAnH2ForTheSelectedTab(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_TABS);
  renderPage(asUser("asset_group_admin"));

  await screen.findByText("Power tile");
  expect(screen.getByRole("heading", { level: 2, name: "Power" })).toBeInTheDocument();
}

/** The untabbed canvas has the same `h1` → `h3` gap, so it carries an `h2` too. Mutation: drop the
 * untabbed heading => red. */
export async function anUntabbedViewerHasAnH2(): Promise<void> {
  stubLiveCanvas();
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_WIDGET);
  renderPage(asUser("asset_group_admin"));

  await screen.findByText("Energy today");
  expect(screen.getByRole("heading", { level: 2, name: "Widgets" })).toBeInTheDocument();
}

/** DV1 — a DTO with one widget renders it via `DashboardLiveCanvas`, below the heading. */
export async function aWidgetRendersViaTheLiveCanvas(): Promise<void> {
  mocks.io.mockImplementation(() => ({ on: vi.fn(), disconnect: mocks.disconnect }));
  mocks.fetchTelemetryRecent.mockResolvedValue([]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(DTO_WITH_WIDGET);
  renderPage(asUser("asset_group_admin"));

  await screen.findByRole("heading", { name: "Site A Overview" });
  expect(await screen.findByText("Energy today")).toBeInTheDocument();
}
