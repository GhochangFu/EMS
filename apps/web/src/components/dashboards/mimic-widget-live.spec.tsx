import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import {
  MIMIC_PRESETS,
  type DashboardDto,
  type DashboardMimicNodesResponseDto,
  type DashboardWidgetDto,
  type GeneratedSiteAssetDto,
  type MimicNodeDto,
  type TelemetryReading,
} from "@bms/shared";

import { MIMIC_REFRESH_MS } from "../../hooks/use-mimic-nodes";
import { useAuthStore } from "../../stores/auth-store";
import { DashboardLiveCanvas } from "./dashboard-live-canvas";
import { MimicWidgetLive } from "./mimic-widget-live";

/**
 * `F3.32` U4 — the mimic's live wiring (ADR 0079, plan §3 U4 "Live").
 *
 * The mimic-nodes read is a module mock (U2 builds the route in parallel), the socket transport
 * is a `vi.fn` that keeps every `telemetry` handler, and `fetch` is a spy that rejects —
 * `cleanupLive` fails the case if anything reached it (the `F3.68` recipe; a web spec otherwise
 * reaches the real API on :4000). The dashboard's own reads (`api/telemetry`,
 * `fetchDashboardCatalogValues`) are mocked the way `dashboard-live-canvas.spec.tsx` mocks them.
 *
 * The dashboard's `slug` differs from its `id`, so a canvas that handed the widget the slug would
 * redden the one-fetch case's argument check.
 */

const mocks = vi.hoisted(() => ({
  fetchDashboardMimicNodes: vi.fn(),
  fetchTelemetryRecent: vi.fn(),
  fetchPointAggregate: vi.fn(),
  fetchDashboardCatalogValues: vi.fn(),
  io: vi.fn(),
  disconnect: vi.fn(),
  telemetryHandlers: [] as ((payload: unknown) => void)[],
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));

vi.mock("../../api/dashboard-mimic", () => ({
  fetchDashboardMimicNodes: mocks.fetchDashboardMimicNodes,
}));

vi.mock("../../api/telemetry", () => ({
  fetchTelemetryRecent: mocks.fetchTelemetryRecent,
  fetchPointAggregate: mocks.fetchPointAggregate,
}));

vi.mock("../../api/dashboards", () => ({
  fetchDashboardCatalogValues: mocks.fetchDashboardCatalogValues,
}));

const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const WIDGET_A = "11111111-1111-4111-8111-111111111111";
const WIDGET_B = "33333333-3333-4333-8333-333333333333";
const WTP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "token-mimic-live";

type MimicWidgetDto = Extract<DashboardWidgetDto, { widgetType: "mimic" }>;

function mimicWidget(id: string, title: string): MimicWidgetDto {
  return {
    id,
    dashboardId: DASHBOARD_ID,
    organizationId: "org-1",
    title,
    gridX: 0,
    gridY: 0,
    gridW: 12,
    gridH: 6,
    points: [],
    sources: [],
    widgetType: "mimic",
    config: { source: "preset", preset: "water_train" },
  };
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** WTP, one point `flow` at 10, last seen `lastSeenAgoMs` ago. */
function wtp(lastSeenAgoMs: number): GeneratedSiteAssetDto {
  return {
    id: WTP_ID,
    code: "WTR-WTP-01",
    name: "Water treatment plant",
    domain: "water",
    latestTelemetryAt: isoAgo(lastSeenAgoMs),
    freshness: "live",
    points: [{ pointKey: "flow", name: "Flow", unit: "m3/h", headlineRank: 1, latest: { value: 10, time: isoAgo(lastSeenAgoMs) } }],
  };
}

function nodes(lastSeenAgoMs: number): MimicNodeDto[] {
  return MIMIC_PRESETS.water_train.nodes.map((n) => ({
    key: n.key,
    label: n.label,
    roleCode: n.roleCode,
    asset: n.key === "wtp" ? wtp(lastSeenAgoMs) : null,
    memberCount: n.key === "wtp" ? 1 : 0,
    activeAlarms: 0,
    topAlarm: null,
  }));
}

function response(widgetIds: string[], lastSeenAgoMs = 1_000): DashboardMimicNodesResponseDto {
  return {
    dashboardId: DASHBOARD_ID,
    resolvedAt: new Date().toISOString(),
    widgets: widgetIds.map((widgetId) => ({ widgetId, preset: "water_train", nodes: nodes(lastSeenAgoMs) })),
  };
}

function dashboard(widgets: DashboardWidgetDto[]): DashboardDto {
  return {
    id: DASHBOARD_ID,
    organizationId: "org-1",
    slug: "demo-water-plant-mimic",
    name: "Demo water plant",
    description: null,
    locationId: null,
    assetGroupId: "44444444-4444-4444-8444-444444444444",
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    widgets,
  };
}

let fetchSpy: Mock | null = null;

function arrange(answer: () => Promise<DashboardMimicNodesResponseDto>): QueryClient {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  mocks.telemetryHandlers.length = 0;
  mocks.io.mockImplementation(() => ({
    on: (name: string, handler: (payload: unknown) => void) => {
      if (name === "telemetry") mocks.telemetryHandlers.push(handler);
    },
    disconnect: mocks.disconnect,
  }));
  mocks.fetchDashboardMimicNodes.mockImplementation(answer);
  mocks.fetchTelemetryRecent.mockResolvedValue([]);
  mocks.fetchPointAggregate.mockResolvedValue({ stats: null, buckets: [] });
  mocks.fetchDashboardCatalogValues.mockResolvedValue({ values: [], resolvedAt: null });
  useAuthStore.setState({ accessToken: TOKEN });
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWidget(answer: () => Promise<DashboardMimicNodesResponseDto>, widget = mimicWidget(WIDGET_A, "Train A")): void {
  const client = arrange(answer);
  render(
    <QueryClientProvider client={client}>
      <MimicWidgetLive widget={widget} dashboardId={DASHBOARD_ID} />
    </QueryClientProvider>,
  );
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

function emit(readings: TelemetryReading[]): void {
  expect(mocks.telemetryHandlers.length, "no telemetry handler was registered").toBeGreaterThan(0);
  act(() => {
    for (const handler of mocks.telemetryHandlers) handler({ readings });
  });
}

function wtpNode(): HTMLElement {
  const el = screen.getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === "wtp");
  expect(el, "no wtp node").toBeDefined();
  return el as HTMLElement;
}

function wtpValue(): string {
  return within(wtpNode()).getByTestId("mimic-point-value").textContent ?? "";
}

/** LV1 — two mimics on one canvas: one read, for the dashboard's id; both draw their nodes. */
export async function twoMimicsOnACanvasShareOneRead(): Promise<void> {
  const client = arrange(() => Promise.resolve(response([WIDGET_A, WIDGET_B])));
  render(
    <QueryClientProvider client={client}>
      <DashboardLiveCanvas dashboard={dashboard([mimicWidget(WIDGET_A, "Train A"), mimicWidget(WIDGET_B, "Train B")])} />
    </QueryClientProvider>,
  );
  await screen.findAllByText("WTR-WTP-01");
  expect(screen.getAllByText("WTR-WTP-01")).toHaveLength(2);
  expect(screen.getAllByTestId("mimic-node")).toHaveLength(16);
  expect(mocks.fetchDashboardMimicNodes).toHaveBeenCalledTimes(1);
  expect(mocks.fetchDashboardMimicNodes).toHaveBeenCalledWith(DASHBOARD_ID);
}

/** LV2 — a socket reading for a node's point replaces the seeded value. */
export async function socketReadingReplacesTheValue(): Promise<void> {
  renderWidget(() => Promise.resolve(response([WIDGET_A])));
  await screen.findByText("WTR-WTP-01");
  expect(wtpValue()).toBe("10 m3/h");
  emit([{ assetId: WTP_ID, pointKey: "flow", value: 42.5, unit: "m3/h", time: new Date().toISOString() }]);
  expect(wtpValue()).toBe("42.5 m3/h");
}

/** LV3 — a reading for an asset the mimic does not hold changes nothing. */
export async function foreignReadingChangesNothing(): Promise<void> {
  renderWidget(() => Promise.resolve(response([WIDGET_A])));
  await screen.findByText("WTR-WTP-01");
  emit([{ assetId: STRANGER_ID, pointKey: "flow", value: 42.5, unit: "m3/h", time: new Date().toISOString() }]);
  expect(wtpValue()).toBe("10 m3/h");
  expect(screen.queryByText(/42\.5/)).toBeNull();
}

/** LV4 — a stale node turns live on a socket reading: status reads the overlay, not `freshness`. */
export async function socketReadingTurnsAStaleNodeLive(): Promise<void> {
  renderWidget(() => Promise.resolve(response([WIDGET_A], 10 * 60_000)));
  await screen.findByText("WTR-WTP-01");
  expect(wtpNode().getAttribute("data-status")).toBe("stale");
  emit([{ assetId: WTP_ID, pointKey: "flow", value: 11, unit: "m3/h", time: new Date().toISOString() }]);
  expect(wtpNode().getAttribute("data-status")).toBe("live");
}

/** LV5 — a widget the response does not list draws every node, unassigned, without throwing. */
export async function aWidgetMissingFromTheResponseDrawsUnassigned(): Promise<void> {
  renderWidget(() => Promise.resolve(response([WIDGET_B])));
  await screen.findAllByText("Not assigned");
  const statuses = screen.getAllByTestId("mimic-node").map((n) => n.getAttribute("data-status"));
  expect(statuses).toEqual(Array(8).fill("unassigned"));
}

/** LV6 — a failed read shows the frame's error line and no node. */
export async function aFailedReadShowsTheErrorLine(): Promise<void> {
  renderWidget(() => Promise.reject(new Error("mimic-nodes 500")));
  await screen.findByText("Could not load widget.");
  expect(screen.queryAllByTestId("mimic-node")).toHaveLength(0);
}

/** LV7 — the read refetches every 30 s (owner ruling 7), and not before. */
export async function refetchesEveryThirtySeconds(): Promise<void> {
  vi.useFakeTimers({ now: Date.parse("2026-09-28T10:00:00.000Z") });
  renderWidget(() => Promise.resolve(response([WIDGET_A])));
  const advance = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  await advance(0);
  expect(mocks.fetchDashboardMimicNodes).toHaveBeenCalledTimes(1);
  await advance(MIMIC_REFRESH_MS - 1_000);
  expect(mocks.fetchDashboardMimicNodes).toHaveBeenCalledTimes(1);
  await advance(1_000);
  expect(mocks.fetchDashboardMimicNodes).toHaveBeenCalledTimes(2);
  expect(MIMIC_REFRESH_MS).toBe(30_000);
}

/** LV8 — a failed 30 s refetch keeps the last good drawing, and shows no error line. */
export async function aFailedRefetchKeepsTheLastDrawing(): Promise<void> {
  vi.useFakeTimers({ now: Date.parse("2026-09-28T10:00:00.000Z") });
  let calls = 0;
  renderWidget(() => {
    calls += 1;
    return calls === 1 ? Promise.resolve(response([WIDGET_A])) : Promise.reject(new Error("mimic-nodes 500"));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MIMIC_REFRESH_MS);
  });
  expect(calls, "the refetch did not run").toBe(2);
  expect(screen.getAllByTestId("mimic-node")).toHaveLength(8);
  expect(screen.getByText("WTR-WTP-01")).toBeInTheDocument();
  expect(screen.queryByText("Could not load widget.")).toBeNull();
}
