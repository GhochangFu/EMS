import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import {
  MIMIC_PRESETS,
  type DashboardDto,
  type DashboardMimicNodesResponseDto,
  type DashboardWidgetDto,
  type GeneratedSiteAssetDto,
  type MimicLayoutNodeDto,
  type MimicNodeDto,
  type MimicSymbol,
  type TelemetryReading,
} from "@bms/shared";

import { MIMIC_REFRESH_MS } from "../../hooks/use-mimic-nodes";
import { useAuthStore } from "../../stores/auth-store";
import { MIMIC_FRAME_CHROME_PX } from "../widgets/mimic-widget";
import { CanvasTileAspectProvider, type TileAspect } from "./dashboard-canvas";
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
    tabId: null,
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
    statePoints: [],
    members: [],
  }));
}

function response(widgetIds: string[], lastSeenAgoMs = 1_000): DashboardMimicNodesResponseDto {
  return {
    dashboardId: DASHBOARD_ID,
    resolvedAt: new Date().toISOString(),
    stateMaps: [],
    widgets: widgetIds.map((widgetId) => ({
      source: "preset" as const,
      widgetId,
      preset: "water_train" as const,
      nodes: nodes(lastSeenAgoMs),
    })),
  };
}

const LAYOUT_ID = "55555555-5555-4555-8555-555555555555";

function layoutWidget(id: string): MimicWidgetDto {
  return { ...mimicWidget(id, "Plant B"), config: { source: "layout", layoutId: LAYOUT_ID } };
}

function layoutNode(key: string, symbol: MimicSymbol, roleCode: string | null, x: number): MimicLayoutNodeDto {
  return { key, kind: "unit", symbol, label: key, roleCode, tone: null, x, y: 2, w: 20, h: 25, z: 0, fanOut: false, isSource: false };
}

/**
 * A layout answer: `feed` (roled `wtp`, resolved to WTP) piped to a passive `drain`. Neither key
 * is a preset key, so a widget that drew the preset instead reddens on the unit keys.
 */
function layoutResponse(widgetId: string): DashboardMimicNodesResponseDto {
  return {
    dashboardId: DASHBOARD_ID,
    resolvedAt: new Date().toISOString(),
    stateMaps: [],
    widgets: [
      {
        source: "layout",
        widgetId,
        layoutId: LAYOUT_ID,
        layout: {
          name: "Plant B",
          canvasW: 80,
          canvasH: 40,
          nodes: [layoutNode("feed", "tank", "wtp", 2), layoutNode("drain", "discharge", null, 40)],
          pipes: [{ fromKey: "feed", toKey: "drain" }],
          orgSymbols: [],
        },
        nodes: [
          { key: "feed", label: "feed", roleCode: "wtp", asset: wtp(1_000), memberCount: 1, activeAlarms: 0, topAlarm: null, statePoints: [], members: [] },
        ],
      },
    ],
  };
}

function unitKeys(): (string | null)[] {
  return screen.getAllByTestId("mimic-node").map((n) => n.getAttribute("data-node-key"));
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
    templateId: null,
    tabs: [],
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

/**
 * LV9 (`F3.32c`) — a layout widget draws the layout the read answered: its units, the roled one
 * resolved, the passive one marked passive, and the pipe between them.
 */
export async function aLayoutWidgetDrawsItsLayout(): Promise<void> {
  renderWidget(() => Promise.resolve(layoutResponse(WIDGET_A)), layoutWidget(WIDGET_A));
  await screen.findByText("WTR-WTP-01");
  expect(unitKeys()).toEqual(["feed", "drain"]);
  const drain = screen.getAllByTestId("mimic-node")[1] as HTMLElement;
  expect(drain.getAttribute("data-status")).toBe("passive");
  expect(screen.getAllByTestId("mimic-pipe")).toHaveLength(1);
  expect(screen.getByRole("img", { name: "Plant B: Plant B" })).toBeInTheDocument();
}

/**
 * LV10 (`F3.32c`) — the entry's `source` decides, not the widget's config: a widget whose config
 * still says preset, answered with a layout, draws the layout.
 */
export async function theEntrySourceDecidesTheDrawing(): Promise<void> {
  renderWidget(() => Promise.resolve(layoutResponse(WIDGET_A)), mimicWidget(WIDGET_A, "Plant B"));
  await screen.findByText("WTR-WTP-01");
  expect(unitKeys()).toEqual(["feed", "drain"]);
  expect(screen.queryByTestId("mimic-sink")).toBeNull();
}

function renderInTile(
  answer: () => Promise<DashboardMimicNodesResponseDto>,
  widget: MimicWidgetDto,
): Mock<(aspect: TileAspect | null) => void> {
  const client = arrange(answer);
  const report = vi.fn<(aspect: TileAspect | null) => void>();
  render(
    <QueryClientProvider client={client}>
      <CanvasTileAspectProvider value={report}>
        <MimicWidgetLive widget={widget} dashboardId={DASHBOARD_ID} />
      </CanvasTileAspectProvider>
    </QueryClientProvider>,
  );
  return report;
}

/**
 * LV12 (`F3.73` critique fixes) — a preset mimic reports its drawing's aspect (water train,
 * 1260 x 680) and its frame's 49 px to the canvas tile it sits in.
 */
export async function aPresetMimicReportsItsAspect(): Promise<void> {
  const report = renderInTile(() => Promise.resolve(response([WIDGET_A])), mimicWidget(WIDGET_A, "Train A"));
  await screen.findByText("WTR-WTP-01");
  expect(report).toHaveBeenLastCalledWith({ ratio: 680 / 1260, chromePx: MIMIC_FRAME_CHROME_PX });
  expect(MIMIC_FRAME_CHROME_PX).toBe(49);
}

/**
 * LV13 (`F3.73` critique fixes) — a layout mimic reports its layout's aspect once the read
 * answers: an 80 x 40 grid is a 2:1 drawing, not the preset's.
 */
export async function aLayoutMimicReportsItsLayoutAspect(): Promise<void> {
  const report = renderInTile(() => Promise.resolve(layoutResponse(WIDGET_A)), layoutWidget(WIDGET_A));
  await screen.findByText("WTR-WTP-01");
  expect(report).toHaveBeenLastCalledWith({ ratio: 0.5, chromePx: MIMIC_FRAME_CHROME_PX });
}

/** LV11 (`F3.32c`) — a layout widget the read does not list draws nothing, and does not throw. */
export async function aLayoutWidgetMissingFromTheResponseDrawsNothing(): Promise<void> {
  renderWidget(() => Promise.resolve(response([WIDGET_B])), layoutWidget(WIDGET_A));
  await screen.findByRole("img", { name: "Plant B: Plant mimic" });
  expect(screen.queryAllByTestId("mimic-node")).toHaveLength(0);
}

const Q6_ID = "66666666-6666-4666-8666-666666666666";
const Q7_ID = "77777777-7777-4777-8777-777777777777";
const TX_ID = "88888888-8888-4888-8888-888888888888";

/** A fresh electrical asset with one headline point and, for a breaker, `breaker_main` 1. */
function electrical(id: string, code: string, breaker: boolean) {
  const at = isoAgo(1_000);
  return {
    asset: {
      id,
      code,
      name: code,
      domain: "electrical",
      latestTelemetryAt: at,
      freshness: "live" as const,
      points: [{ pointKey: "current_a", name: "Current", unit: "A", headlineRank: 1, latest: { value: 40, time: at } }],
    },
    statePoints: breaker ? [{ pointKey: "breaker_main", name: "Main", unit: "", headlineRank: 10, latest: { value: 1, time: at } }] : [],
  };
}

/**
 * `F3.74` — an `lv_single_line` answer: `load_feeders` fans out to Q6 and Q7 (Q7 only in
 * `members`), `transformer` holds TX with a value row, and the maps are the response's.
 */
function sldResponse(widgetId: string): DashboardMimicNodesResponseDto {
  const q6 = electrical(Q6_ID, "CR-Q6", true);
  const q7 = electrical(Q7_ID, "CR-Q7", true);
  const tx = electrical(TX_ID, "TX-1", false);
  const base = { activeAlarms: 0, topAlarm: null };
  return {
    dashboardId: DASHBOARD_ID,
    resolvedAt: new Date().toISOString(),
    stateMaps: [
      {
        pointKey: "breaker_main",
        states: [
          { value: 0, label: "OPEN", tone: "open" },
          { value: 1, label: "CLOSED", tone: "closed" },
        ],
      },
    ],
    widgets: [
      {
        source: "preset",
        widgetId,
        preset: "lv_single_line",
        nodes: [
          { key: "transformer", label: "Transformer", roleCode: "transformer", asset: tx.asset, memberCount: 1, ...base, statePoints: [], members: [] },
          {
            key: "load_feeders",
            label: "Load feeders",
            roleCode: "load-feeder-breaker",
            asset: q6.asset,
            memberCount: 2,
            ...base,
            statePoints: q6.statePoints,
            members: [
              { ...q6, ...base },
              { ...q7, ...base },
            ],
          },
        ],
      },
    ],
  };
}

function sldWidget(compact: boolean): MimicWidgetDto {
  return {
    ...mimicWidget(WIDGET_A, "SLD"),
    config: compact ? { source: "preset", preset: "lv_single_line", compact: true } : { source: "preset", preset: "lv_single_line" },
  };
}

function feederPills(): (string | null)[][] {
  return screen
    .getAllByTestId("mimic-breaker-member")
    .map((row) => [row.getAttribute("data-asset-code"), within(row).getByTestId("mimic-breaker-pill").textContent]);
}

/**
 * LV-B1 — through the real overlay: the second fan-out member is tracked (its last-seen instant
 * seeds, so it reads CLOSED, not OFFLINE) with the response's maps, and a socket reading on its
 * state key flips its pill; the value rows draw when the config is not compact.
 */
export async function aFanOutMemberIsTrackedAndFlipsOnTheSocket(): Promise<void> {
  renderWidget(() => Promise.resolve(sldResponse(WIDGET_A)), sldWidget(false));
  await screen.findByText("TX-1");
  expect(feederPills()).toEqual([
    ["CR-Q6", "CLOSED"],
    ["CR-Q7", "CLOSED"],
  ]);
  expect(screen.getAllByTestId("mimic-point").length).toBeGreaterThan(0);
  emit([{ assetId: Q7_ID, pointKey: "breaker_main", value: 0, unit: "", time: new Date().toISOString() }]);
  expect(feederPills()).toEqual([
    ["CR-Q6", "CLOSED"],
    ["CR-Q7", "OPEN"],
  ]);
}

/** LV-B2 — a preset config's `compact` reaches the scene: no value row draws, the pills stay. */
export async function aCompactConfigReachesTheScene(): Promise<void> {
  renderWidget(() => Promise.resolve(sldResponse(WIDGET_A)), sldWidget(true));
  await screen.findByText("TX-1");
  expect(screen.queryAllByTestId("mimic-point")).toHaveLength(0);
  expect(feederPills()).toHaveLength(2);
}
