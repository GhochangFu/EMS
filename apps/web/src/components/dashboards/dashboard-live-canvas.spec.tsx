import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import { encodePointRef, type DashboardDto, type DashboardWidgetDto } from "@bms/shared";

import { siteWidgetsQueryPrefix } from "../../hooks/use-site-widgets";
import { useAuthStore } from "../../stores/auth-store";
import { DashboardLiveCanvas } from "./dashboard-live-canvas";
import { NewestReadContext } from "./newest-read-context";

/**
 * `F3.69` U1 — `DashboardLiveCanvas`, byte-moved out of `DashboardViewerPage`
 * (plan decision D2): `useDashboardTelemetry`, the tile map, the empty-state
 * line and `DashboardCanvas` + `DashboardWidgetLive`.
 *
 * Assertions live here; `dashboard-live-canvas.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR
 * 0042 decision 2).
 *
 * `fetch` is stubbed with the spy-and-assert-empty pattern
 * (`site-page.spec.tsx`) — an unstubbed read reaches a real API on :4000.
 * `socket.io-client`, `../../api/telemetry` and `fetchDashboardCatalogValues`
 * are module mocks, per the plan's U1 row (precedent: `generated-site-view.spec.tsx`).
 */

const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  disconnect: vi.fn(),
  fetchTelemetryRecent: vi.fn(),
  fetchPointAggregate: vi.fn(),
  fetchDashboardCatalogValues: vi.fn(),
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));

vi.mock("../../api/telemetry", () => ({
  fetchTelemetryRecent: mocks.fetchTelemetryRecent,
  fetchPointAggregate: mocks.fetchPointAggregate,
}));

vi.mock("../../api/dashboards", () => ({
  fetchDashboardCatalogValues: mocks.fetchDashboardCatalogValues,
}));

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "token-dlc";
const REF = encodePointRef(ASSET_ID, "kw");

function point(): DashboardWidgetDto["points"][number] {
  return {
    id: "point-1",
    pointId: "point-1",
    role: "primary",
    sortOrder: 0,
    assetId: ASSET_ID,
    assetCode: "AHU-01",
    pointKey: "kw",
    unit: "kWh",
  };
}

function widget(bound: boolean): DashboardWidgetDto {
  return {
    id: "widget-1",
    dashboardId: "dash-1",
    organizationId: "org-1",
    title: "Energy today",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    points: bound ? [point()] : [],
    sources: [],
    tabId: null,
    widgetType: "value_tile",
    config: { unit: "kWh", decimals: 2 },
  } as DashboardWidgetDto;
}

function dashboard(widgets: DashboardWidgetDto[]): DashboardDto {
  return {
    id: "dash-1",
    organizationId: "org-1",
    slug: "phe-lotapata",
    name: "Lotapata Overview",
    description: null,
    locationId: "loc-1",
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: null,
    tabs: [],
    widgets,
  };
}

let fetchSpy: Mock | null = null;

function renderCanvas(dto: DashboardDto, tabKey?: string): ReturnType<typeof render> {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  mocks.io.mockImplementation(() => ({ on: vi.fn(), disconnect: mocks.disconnect }));
  mocks.fetchTelemetryRecent.mockResolvedValue([]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
  mocks.fetchDashboardCatalogValues.mockResolvedValue({ values: [], resolvedAt: null });
  useAuthStore.setState({ accessToken: TOKEN });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardLiveCanvas dashboard={dto} tabKey={tabKey} />
    </QueryClientProvider>,
  );
}

/** Unmounts, restores the stubbed `fetch` and auth state, and fails the case if any read
 * reached the network. */
export function cleanupCanvas(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  useAuthStore.setState({ accessToken: null });
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}

/** L1 — an empty dashboard prints the empty-state line and draws no tile. */
export async function emptyDashboardShowsNoWidgetsLine(): Promise<void> {
  renderCanvas(dashboard([]));
  expect(await screen.findByText("This dashboard has no widgets yet.")).toBeInTheDocument();
  expect(screen.queryByText("Energy today")).toBeNull();
}

/** L2 — one widget renders as a tile, found by its title. */
export async function oneWidgetRendersItsTile(): Promise<void> {
  renderCanvas(dashboard([widget(true)]));
  expect(await screen.findByText("Energy today")).toBeInTheDocument();
}

/** L3 — a widget bound to a ref makes the canvas fetch that ref's recent telemetry. */
export async function boundWidgetFetchesItsRef(): Promise<void> {
  renderCanvas(dashboard([widget(true)]));
  await screen.findByText("Energy today");
  expect(mocks.fetchTelemetryRecent).toHaveBeenCalledWith(REF, expect.any(String));
}

const TAB_OVERVIEW = "11111111-1111-4111-8111-111111111111";
const TAB_SLD = "22222222-2222-4222-8222-222222222222";

/** `F3.73` — a two-tab dashboard: an unbound tile on each tab, told apart by its title. */
function tabbedDashboard(): DashboardDto {
  const tab = (id: string, key: string, sortOrder: number) => ({
    id,
    dashboardId: "dash-1",
    organizationId: "org-1",
    key,
    label: key.toUpperCase(),
    sortOrder,
    assetGroupId: null,
  });
  const onTab = (id: string, title: string, tabId: string): DashboardWidgetDto =>
    ({ ...widget(false), id, title, tabId }) as DashboardWidgetDto;
  return {
    ...dashboard([onTab("widget-a", "Overview tile", TAB_OVERVIEW), onTab("widget-b", "SLD tile", TAB_SLD)]),
    tabs: [tab(TAB_OVERVIEW, "overview", 0), tab(TAB_SLD, "sld", 1)],
  };
}

/** L5 — `F3.73` plan D10: with `tabKey`, only that tab's widgets render (tab A's tile is absent). */
export async function aTabKeyShowsOnlyThatTabsWidgets(): Promise<void> {
  renderCanvas(tabbedDashboard(), "sld");
  expect(await screen.findByText("SLD tile")).toBeInTheDocument();
  expect(screen.queryByText("Overview tile")).toBeNull();
}

/** L6 — no `tabKey` (the viewer page) renders every widget of a tabbed dashboard, as before. */
export async function noTabKeyShowsEveryWidget(): Promise<void> {
  renderCanvas(tabbedDashboard());
  expect(await screen.findByText("SLD tile")).toBeInTheDocument();
  expect(screen.getByText("Overview tile")).toBeInTheDocument();
}

// In the past of any clock the suite runs on: the canvas clamps a time ahead of `now` (F4.37).
const SAMPLE_AT = Date.UTC(2026, 0, 2, 4, 15, 0);
const CATALOG_AT = SAMPLE_AT + 9_000;

/**
 * `F3.77` plan D9 — a bound widget that also binds a catalog source, rendered under a reporter
 * spy: the seed answers one sample at `sampleAt`, the catalog read resolves at `catalogAt`.
 */
async function reportedNewestRead(sampleAt: number, catalogAt: number): Promise<Mock> {
  const report = vi.fn();
  const bound = {
    ...widget(true),
    sources: [{ id: "source-1", catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
  } as DashboardWidgetDto;
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  mocks.io.mockImplementation(() => ({ on: vi.fn(), disconnect: mocks.disconnect }));
  mocks.fetchTelemetryRecent.mockResolvedValue([
    { time: new Date(sampleAt).toISOString(), assetId: ASSET_ID, pointKey: "kw", value: 4, unit: "kWh" },
  ]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
  mocks.fetchDashboardCatalogValues.mockResolvedValue({ values: [], resolvedAt: new Date(catalogAt).toISOString() });
  useAuthStore.setState({ accessToken: TOKEN });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewestReadContext.Provider value={report}>
        <DashboardLiveCanvas dashboard={dashboard([bound])} />
      </NewestReadContext.Provider>
    </QueryClientProvider>,
  );
  await screen.findByText("Energy today");
  // Both reads reached the canvas before the claim: the newest is a choice between two times.
  await waitFor(() => {
    expect(mocks.fetchTelemetryRecent).toHaveBeenCalledWith(REF, expect.any(String));
    expect(mocks.fetchDashboardCatalogValues).toHaveBeenCalledWith("dash-1");
    expect(report).toHaveBeenCalledWith(sampleAt > catalogAt ? sampleAt : catalogAt);
  });
  return report;
}

/** L7 — `F3.77` D9: a catalog read newer than the sample is the reported newest read. */
export async function theCanvasReportsTheNewerCatalogRead(): Promise<void> {
  const report = await reportedNewestRead(SAMPLE_AT, CATALOG_AT);
  expect(report.mock.calls.at(-1)).toEqual([CATALOG_AT]);
}

/** L8 — `F3.77` D9: a sample newer than the catalog read is the reported newest read. */
export async function theCanvasReportsTheNewerSample(): Promise<void> {
  const report = await reportedNewestRead(CATALOG_AT, SAMPLE_AT);
  expect(report.mock.calls.at(-1)).toEqual([CATALOG_AT]);
}

/**
 * L9 — `F3.77` D9: the tab's site-widgets read counts. A catalog-only Overview has no sample, and
 * the catalog polls every minute (`CATALOG_REFRESH_MS`, above `FRESH_MS`), so this read is what
 * keeps the wall's line live between catalog reads.
 */
export async function theCanvasReportsTheSiteWidgetsRead(): Promise<void> {
  const report = vi.fn();
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  mocks.io.mockImplementation(() => ({ on: vi.fn(), disconnect: mocks.disconnect }));
  useAuthStore.setState({ accessToken: TOKEN });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData([...siteWidgetsQueryPrefix, "dash-1", "overview"], { tabs: [] }, { updatedAt: CATALOG_AT });
  render(
    <QueryClientProvider client={queryClient}>
      <NewestReadContext.Provider value={report}>
        <DashboardLiveCanvas dashboard={tabbedDashboard()} tabKey="overview" />
      </NewestReadContext.Provider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Overview tile")).toBeInTheDocument();
  expect(mocks.fetchTelemetryRecent, "control: no sample on this tab").not.toHaveBeenCalled();
  expect(mocks.fetchDashboardCatalogValues, "control: no catalog read on this tab").not.toHaveBeenCalled();
  await waitFor(() => {
    expect(report).toHaveBeenCalledWith(CATALOG_AT);
  });
}

/** L4 — one socket, opened with the session token; disconnected on unmount. */
export async function oneSocketWithTokenDisconnectsOnUnmount(): Promise<void> {
  const { unmount } = renderCanvas(dashboard([widget(true)]));
  await screen.findByText("Energy today");
  expect(mocks.io).toHaveBeenCalledTimes(1);
  const [, options] = mocks.io.mock.calls[0] as [string, { auth?: { token?: string } }];
  expect(options.auth?.token).toBe(TOKEN);
  expect(mocks.disconnect, "control: still connected while mounted").not.toHaveBeenCalled();
  unmount();
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
}
