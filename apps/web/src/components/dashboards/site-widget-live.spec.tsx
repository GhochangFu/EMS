import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, DashboardWidgetDto, SiteWidgetsResponse } from "@bms/shared";

import { SITE_WIDGETS_REFETCH_MS } from "../../hooks/use-site-widgets";
import { useAuthStore } from "../../stores/auth-store";
import { SiteTabHrefContext, type SiteTabHref } from "../widgets/site-widget-parts";
import { DashboardLiveCanvas } from "./dashboard-live-canvas";

/**
 * `F3.73` (plan Task 3.5) — the site widgets' live wiring, driven through `DashboardLiveCanvas` so
 * the tab key is the one the canvas derives from `widget.tabId` and the dashboard's own `tabs`.
 *
 * The site-widgets read and the vocabulary are module mocks; the socket transport keeps its
 * `alarm` handler so a case can fire an event; `fetch` is a spy that rejects, and `cleanupLive`
 * fails the case if anything reached it (the `F3.68` recipe — a web spec otherwise reaches the real
 * API on :4000). The dashboard's own telemetry reads are mocked like `mimic-widget-live.spec.tsx`.
 */

const mocks = vi.hoisted(() => ({
  fetchSiteWidgets: vi.fn(),
  fetchVocabularies: vi.fn(),
  fetchTelemetryRecent: vi.fn(),
  fetchPointAggregate: vi.fn(),
  fetchDashboardCatalogValues: vi.fn(),
  io: vi.fn(),
  alarmHandlers: [] as ((payload: unknown) => void)[],
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("../../api/dashboard-site-widgets", () => ({ fetchSiteWidgets: mocks.fetchSiteWidgets }));
vi.mock("../../api/vocabularies", () => ({
  vocabulariesQueryKey: ["vocabularies"],
  fetchVocabularies: mocks.fetchVocabularies,
}));
vi.mock("../../api/telemetry", () => ({
  fetchTelemetryRecent: mocks.fetchTelemetryRecent,
  fetchPointAggregate: mocks.fetchPointAggregate,
}));
vi.mock("../../api/dashboards", () => ({ fetchDashboardCatalogValues: mocks.fetchDashboardCatalogValues }));

const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const UPS_TAB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HVAC_TAB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OVERVIEW_TAB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";

const COMMON = {
  dashboardId: DASHBOARD_ID,
  organizationId: "org-1",
  title: null,
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  points: [],
  sources: [],
};

function widget(id: string, tabId: string | null, rest: Record<string, unknown>): DashboardWidgetDto {
  return { ...COMMON, id, tabId, ...rest } as unknown as DashboardWidgetDto;
}

const RAIL = widget("11111111-1111-4111-8111-111111111111", UPS_TAB_ID, {
  widgetType: "active_alarms_rail",
  config: { rows: 8, showSummary: true },
});
const CARD_UPS = widget("33333333-3333-4333-8333-333333333333", UPS_TAB_ID, {
  widgetType: "module_summary_card",
  config: { targetTabKey: "hvac" },
});
const LIST_HVAC = widget("55555555-5555-4555-8555-555555555555", HVAC_TAB_ID, {
  widgetType: "critical_systems_list",
  config: {},
});
const LEGEND_OVERVIEW = widget("66666666-6666-4666-8666-666666666666", null, {
  widgetType: "state_legend",
  config: {},
});

function dashboard(widgets: DashboardWidgetDto[]): DashboardDto {
  const tab = (id: string, key: string, label: string, sortOrder: number, assetGroupId: string | null = GROUP_ID) => ({
    id,
    dashboardId: DASHBOARD_ID,
    organizationId: "org-1",
    key,
    label,
    sortOrder,
    assetGroupId,
  });
  return {
    id: DASHBOARD_ID,
    organizationId: "org-1",
    slug: "site-dashboard",
    name: "Site",
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: null,
    tabs: [
      tab(OVERVIEW_TAB_ID, "overview", "Main Dashboard", 0, null),
      tab(UPS_TAB_ID, "ups", "UPS", 1),
      tab(HVAC_TAB_ID, "hvac", "HVAC", 2),
    ],
    widgets,
  };
}

function response(tabKey: string | null, alarmMessage: string): SiteWidgetsResponse {
  return {
    dashboardId: DASHBOARD_ID,
    tabKey,
    resolvedAt: "2026-09-30T10:20:00.000Z",
    scope: { assetCount: 3 },
    alarms: {
      active: [
        {
          id: "a1",
          assetId: "asset-1",
          ruleKey: null,
          ruleId: null,
          severity: "critical",
          message: alarmMessage,
          raisedAt: "2026-09-30T10:15:00.000Z",
          acknowledgedAt: null,
          acknowledgedBy: null,
          clearedAt: null,
          assetCode: "UPS-01",
          assetName: "UPS 01",
          siteName: "Site",
        },
      ],
      summary: [],
    },
    roles: [],
    tabs: [
      { tabKey: "ups", label: "UPS", assetGroupId: GROUP_ID, status: null },
      { tabKey: "hvac", label: "HVAC", assetGroupId: GROUP_ID, status: null },
    ],
  };
}

let fetchSpy: Mock | null = null;

/** Where the canvas is drawn: the site page (the default), or the dashboard viewer with its `?tab=` link builder. */
type CanvasRoute = { entry: string; path: string; tabHref: SiteTabHref | null };
const SITE_ROUTE: CanvasRoute = { entry: "/control-room/site/loc-9/overview", path: "/control-room/site/:locationId/:tab?", tabHref: null };

function renderCanvas(
  widgets: DashboardWidgetDto[],
  answer: (tabKey: string | null) => Promise<SiteWidgetsResponse>,
  route: CanvasRoute = SITE_ROUTE,
): QueryClient {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  mocks.alarmHandlers.length = 0;
  mocks.io.mockImplementation(() => ({
    on: (name: string, handler: (payload: unknown) => void) => {
      if (name === "alarm") mocks.alarmHandlers.push(handler);
    },
    disconnect: vi.fn(),
  }));
  mocks.fetchSiteWidgets.mockImplementation((_id: string, tabKey: string | null) => answer(tabKey));
  mocks.fetchVocabularies.mockResolvedValue({ alarmSeverities: [] });
  mocks.fetchTelemetryRecent.mockResolvedValue([]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
  mocks.fetchDashboardCatalogValues.mockResolvedValue({ values: [], resolvedAt: null });
  useAuthStore.setState({ accessToken: "token-site-live" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route.entry]}>
        <SiteTabHrefContext.Provider value={route.tabHref}>
          <Routes>
            <Route path={route.path} element={<DashboardLiveCanvas dashboard={dashboard(widgets)} />} />
          </Routes>
        </SiteTabHrefContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

export function cleanupLive(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}

async function settle(): Promise<void> {
  await act(async () => {
    // A macrotask, not microtasks: the query resolves, notifies and re-renders over several ticks.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * One read per dashboard TAB: two widgets on the UPS tab share one request, a widget on the HVAC
 * tab and one on no tab each read their own — three calls, with the tab keys `ups`, `hvac` and
 * `null`. A canvas that passed a constant tab (or the widget's id) would change the keys.
 */
export async function oneReadPerTabWithTheCanvasDerivedTabKey(): Promise<void> {
  renderCanvas([RAIL, CARD_UPS, LIST_HVAC, LEGEND_OVERVIEW], (tabKey) =>
    Promise.resolve(response(tabKey, "Bypass open")),
  );
  await settle();
  const calls = mocks.fetchSiteWidgets.mock.calls.map((call) => [call[0], call[1]]);
  expect(calls).toHaveLength(2);
  expect(calls).toEqual(expect.arrayContaining([[DASHBOARD_ID, "ups"], [DASHBOARD_ID, "hvac"]]));
}

/** The legend reads nothing of its own: a canvas of only a legend makes no site-widgets call, yet draws. */
export async function aLegendReadsNothingButStillDrawsOnTheOverview(): Promise<void> {
  renderCanvas([LEGEND_OVERVIEW], (tabKey) => Promise.resolve(response(tabKey, "x")));
  await settle();
  expect(screen.getByText("Normal")).toBeInTheDocument();
  expect(mocks.fetchSiteWidgets).not.toHaveBeenCalled();
}

/** A widget on no tab reads with `null`, which the API treats as the Overview / legacy scope. */
export async function aWidgetOnNoTabReadsWithANullTabKey(): Promise<void> {
  const overviewRail = widget("77777777-7777-4777-8777-777777777777", null, {
    widgetType: "active_alarms_rail",
    config: { rows: 8, showSummary: true },
  });
  renderCanvas([overviewRail], (tabKey) => Promise.resolve(response(tabKey, "Bypass open")));
  expect(await screen.findByText("Bypass open")).toBeInTheDocument();
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(1);
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledWith(DASHBOARD_ID, null, expect.any(AbortSignal));
}

export async function aFailedReadShowsTheErrorLine(): Promise<void> {
  renderCanvas([RAIL], () => Promise.reject(new Error("site-widgets 500")));
  expect(await screen.findByText("Could not load widget.")).toBeInTheDocument();
}

export async function theFrameShowsLoadingUntilTheFirstAnswer(): Promise<void> {
  renderCanvas([RAIL], () => new Promise<SiteWidgetsResponse>(() => {}));
  await settle();
  expect(screen.getByText("Loading…")).toBeInTheDocument();
}

/** The module card's link is built from the route's own `:locationId`. */
export async function theCardLinksUnderTheRoutesSite(): Promise<void> {
  renderCanvas([CARD_UPS], (tabKey) => Promise.resolve(response(tabKey, "x")));
  const link = await screen.findByRole("link", { name: "Open HVAC" });
  expect(link.getAttribute("href")).toBe("/control-room/site/loc-9/hvac");
}

/**
 * `F3.77` review fix — on the site route the card's link keeps the current query, as the tab
 * strip's links do, so an Open chosen on a wall stays in wall mode. Mutation: drop the route's
 * `search` from the site-route link => red.
 */
export async function onTheSiteRouteTheCardLinkKeepsTheQuery(): Promise<void> {
  renderCanvas([CARD_UPS], (tabKey) => Promise.resolve(response(tabKey, "x")), {
    ...SITE_ROUTE,
    entry: "/control-room/site/loc-9/overview?wall=1&every=30",
  });
  const link = await screen.findByRole("link", { name: "Open HVAC" });
  expect(link.getAttribute("href")).toBe("/control-room/site/loc-9/hvac?wall=1&every=30");
}

/**
 * Critique fix — in the dashboard viewer (no `:locationId`) the card links through the viewer's
 * `SiteTabHrefContext`. The adjacent case is the site page's path link; with neither, no link
 * (the builder's dispatcher passes null).
 */
export async function inTheViewerTheCardLinksToTheTabParam(): Promise<void> {
  renderCanvas([CARD_UPS], (tabKey) => Promise.resolve(response(tabKey, "x")), {
    entry: "/dashboards/site-9",
    path: "/dashboards/:slug",
    tabHref: (key) => `?tab=${key}`,
  });
  const link = await screen.findByRole("link", { name: "Open HVAC" });
  expect(link.getAttribute("href")).toBe("/dashboards/site-9?tab=hvac");
}

/** Off the site page with no viewer context, the card is not a link. */
export async function withNoSiteAndNoViewerTheCardIsNotALink(): Promise<void> {
  renderCanvas([CARD_UPS], (tabKey) => Promise.resolve(response(tabKey, "x")), {
    entry: "/dashboards/site-9",
    path: "/dashboards/:slug",
    tabHref: null,
  });
  expect(await screen.findByText("Outside scope")).toBeInTheDocument();
  expect(screen.queryByRole("link")).toBeNull();
}

/** An alarm event on `/ws/alarms` refetches the tab's read. */
export async function anAlarmEventRefetchesTheRead(): Promise<void> {
  renderCanvas([RAIL], (tabKey) => Promise.resolve(response(tabKey, "Bypass open")));
  await screen.findByText("Bypass open");
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(1);
  expect(mocks.alarmHandlers.length, "no alarm handler was registered").toBeGreaterThan(0);
  act(() => {
    for (const handler of mocks.alarmHandlers) handler({ type: "created" });
  });
  await waitFor(() => expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(2));
}

/** The read also polls every 15 s, for the offline count no socket event announces. */
export async function theReadPollsEveryFifteenSeconds(): Promise<void> {
  vi.useFakeTimers({ now: Date.parse("2026-09-30T10:00:00.000Z") });
  renderCanvas([RAIL], (tabKey) => Promise.resolve(response(tabKey, "Bypass open")));
  const advance = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  await advance(0);
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(1);
  await advance(SITE_WIDGETS_REFETCH_MS - 1_000);
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(1);
  await advance(1_000);
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(2);
  expect(SITE_WIDGETS_REFETCH_MS).toBe(15_000);
}

/** A failed refetch keeps the last good drawing and shows no error line. */
export async function aFailedRefetchKeepsTheLastDrawing(): Promise<void> {
  vi.useFakeTimers({ now: Date.parse("2026-09-30T10:00:00.000Z") });
  let calls = 0;
  renderCanvas([RAIL], (tabKey) => {
    calls += 1;
    return calls === 1 ? Promise.resolve(response(tabKey, "Bypass open")) : Promise.reject(new Error("site-widgets 500"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SITE_WIDGETS_REFETCH_MS);
  });
  expect(calls, "the refetch did not run").toBe(2);
  expect(screen.getByText("Bypass open")).toBeInTheDocument();
  expect(screen.queryByText("Could not load widget.")).toBeNull();
}

/**
 * A widget on a STORED Overview tab (no group) reads with its key, `overview`, not `null`: the
 * read finds the tab row, finds no group on it, and resolves the dashboard's own scope
 * (`SiteWidgetsService.read`), so the key is not a 404. Only a widget on no stored tab sends null.
 */
export async function aWidgetOnAStoredOverviewTabReadsWithItsKey(): Promise<void> {
  const onOverview = widget("88888888-8888-4888-8888-888888888888", OVERVIEW_TAB_ID, {
    widgetType: "asset_class_strip",
    config: {},
  });
  renderCanvas([onOverview], (tabKey) => Promise.resolve(response(tabKey, "x")));
  await screen.findByText("No asset classes in scope");
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(1);
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledWith(DASHBOARD_ID, "overview", expect.any(AbortSignal));
}

/** The `/ws/alarms` sockets the canvas opened; the telemetry socket is a different namespace. */
function alarmSocketCount(): number {
  return mocks.io.mock.calls.filter((call) => String(call[0]).endsWith("/ws/alarms")).length;
}

/**
 * ONE `/ws/alarms` socket per canvas, however many site widgets read: three reading widgets
 * over two tabs. A socket per widget opens three, and socket.io-client dials each separately.
 */
export async function oneAlarmsSocketPerCanvas(): Promise<void> {
  renderCanvas([RAIL, CARD_UPS, LIST_HVAC], (tabKey) => Promise.resolve(response(tabKey, "Bypass open")));
  await screen.findByText("Bypass open");
  expect(alarmSocketCount()).toBe(1);
}

/**
 * One alarm event refetches each TAB's read once: two tabs read (2 calls), one event, 4 calls in
 * all — and still 4 after the queue settles. A handler per widget invalidated three times, and
 * each invalidation cancelled and restarted the in-flight reads: 2 + 3 × 2.
 */
export async function oneAlarmEventRefetchesEachTabOnce(): Promise<void> {
  renderCanvas([RAIL, CARD_UPS, LIST_HVAC], (tabKey) => Promise.resolve(response(tabKey, "Bypass open")));
  await screen.findByText("Bypass open");
  await settle();
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(2);
  act(() => {
    for (const handler of mocks.alarmHandlers) handler({ type: "created" });
  });
  await waitFor(() => expect(mocks.fetchSiteWidgets.mock.calls.length).toBeGreaterThanOrEqual(4));
  await settle();
  expect(mocks.fetchSiteWidgets).toHaveBeenCalledTimes(4);
}

/** A canvas with no reading site widget opens no `/ws/alarms` socket: only the legend here. */
export async function aCanvasWithNoReadingSiteWidgetOpensNoAlarmsSocket(): Promise<void> {
  renderCanvas([LEGEND_OVERVIEW], (tabKey) => Promise.resolve(response(tabKey, "x")));
  await settle();
  expect(screen.getByText("Normal")).toBeInTheDocument();
  expect(alarmSocketCount()).toBe(0);
}
