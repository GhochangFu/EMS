import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import { encodePointRef, type DashboardDto, type DashboardWidgetDto } from "@bms/shared";

import { useAuthStore } from "../../stores/auth-store";
import { DashboardLiveCanvas } from "./dashboard-live-canvas";

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
    widgets,
  };
}

let fetchSpy: Mock | null = null;

function renderCanvas(dto: DashboardDto): ReturnType<typeof render> {
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
      <DashboardLiveCanvas dashboard={dto} />
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
