import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import type {
  GeneratedSiteAssetDto,
  GeneratedSitePointDto,
  GeneratedSiteViewDto,
  LocationDashboardDto,
  TelemetryReading,
} from "@bms/shared";

import { useAuthStore } from "../../stores/auth-store";
import { GeneratedSiteView } from "./generated-site-view";

/**
 * `F3.68` U6 — `GeneratedSiteView` (ADR 0076 decision 7, plan rows W1–W9).
 *
 * Both reads are module mocks and the socket transport is a `vi.fn` that
 * keeps the `telemetry` handler, so a case can fire a reading. `fetch` itself
 * is a spy that rejects, and `cleanupView` fails the case if anything reached
 * it — a throwing `fetch` alone proves nothing, because react-query turns the
 * throw into `isError` (the `F3.66` U4 site-page recipe).
 *
 * The domains are in non-alphabetical order (HVAC before Electrical), so a
 * component that re-sorted them would redden W1.
 */

const mocks = vi.hoisted(() => ({
  fetchGeneratedSiteView: vi.fn(),
  fetchLocationDashboard: vi.fn(),
  io: vi.fn(),
  disconnect: vi.fn(),
  handlers: new Map<string, (payload: unknown) => void>(),
}));

vi.mock("socket.io-client", () => ({ io: mocks.io }));

vi.mock("../../api/generated-site-view", () => ({
  fetchGeneratedSiteView: mocks.fetchGeneratedSiteView,
}));

vi.mock("../../api/locations", () => ({
  fetchLocationDashboard: mocks.fetchLocationDashboard,
}));

const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const AHU_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PCC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "token-gsv-socket";

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function point(
  pointKey: string,
  name: string | null,
  value: number | null,
  ageMs = 5_000,
): GeneratedSitePointDto {
  return {
    pointKey,
    name,
    unit: "kW",
    headlineRank: null,
    latest: value === null ? null : { value, time: isoAgo(ageMs) },
  };
}

function ahu(latestAgoMs: number): GeneratedSiteAssetDto {
  return {
    id: AHU_ID,
    code: "AHU-01",
    name: "Air handler one",
    domain: "hvac",
    latestTelemetryAt: isoAgo(latestAgoMs),
    freshness: "live",
    points: [
      point("kw", "Load", 11),
      point("p2", "Point two", 12),
      point("p3", "Point three", 13),
      point("p4", "Point four", 14),
      point("p5", "Point five", 15),
      point("p6", "Point six", 16),
    ],
  };
}

function pcc(): GeneratedSiteAssetDto {
  return {
    id: PCC_ID,
    code: "PCC-01",
    name: "Power control centre",
    domain: "electrical",
    latestTelemetryAt: null,
    freshness: "none",
    points: [point("kwh_total", "Energy", null)],
  };
}

function siteView(latestAgoMs = 5_000): GeneratedSiteViewDto {
  return {
    locationId: LOCATION_ID,
    asOf: new Date().toISOString(),
    domains: [
      { code: "hvac", label: "HVAC", assets: [ahu(latestAgoMs)] },
      { code: "electrical", label: "Electrical", assets: [pcc()] },
    ],
  };
}

function kpis(scopeLabel: "full" | "partial" = "full"): LocationDashboardDto {
  return {
    id: LOCATION_ID,
    name: "Lotapata",
    code: "PHEWB-LOTAPATA",
    type: "rsmoc",
    province: null,
    organization: { id: "org-1", code: "PHEWB", name: "PHE West Bengal" },
    rtuCount: 3,
    assetCount: 5,
    freshAssetCount: 2,
    totalKw: 123.44,
    openAlarms: 7,
    criticalAlarms: 6,
    scopeLabel,
    rtus: [],
    assets: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 },
    topAssets: [],
    workOrdersOpen: 4,
  };
}

type Answer<T> = T | "reject" | "hang";

function answer<T>(value: Answer<T>, label: string): () => Promise<T> {
  if (value === "reject") {
    return () => Promise.reject(new Error(`${label} 500`));
  }
  if (value === "hang") {
    return () => new Promise<T>(() => undefined);
  }
  return () => Promise.resolve(value);
}

let fetchSpy: Mock | null = null;

function renderView({
  view = siteView(),
  dashboard = kpis(),
}: {
  view?: Answer<GeneratedSiteViewDto>;
  dashboard?: Answer<LocationDashboardDto>;
} = {}): { unmount: () => void } {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  mocks.handlers.clear();
  mocks.io.mockImplementation(() => ({
    on: (name: string, handler: (payload: unknown) => void) => {
      mocks.handlers.set(name, handler);
    },
    disconnect: mocks.disconnect,
  }));
  mocks.fetchGeneratedSiteView.mockImplementation(answer(view, "generated site view"));
  mocks.fetchLocationDashboard.mockImplementation(answer(dashboard, "location dashboard"));
  useAuthStore.setState({ accessToken: TOKEN });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneratedSiteView locationId={LOCATION_ID} />
    </QueryClientProvider>,
  );
}

export function cleanupView(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function card(code: string): HTMLElement {
  return screen.getByRole("article", { name: new RegExp(`^${code} `) });
}

function rowsOf(code: string): HTMLElement[] {
  return within(within(card(code)).getByRole("table", { name: `${code} points` })).getAllByRole("row");
}

function rowText(code: string, name: string): string {
  const row = rowsOf(code).find((r) => within(r).queryByRole("rowheader", { name }) !== null);
  expect(row, `${code} has no row named ${name}`).toBeDefined();
  return row?.textContent ?? "";
}

function pillOf(code: string): string {
  return within(card(code)).getByTestId("asset-status").textContent ?? "";
}

/** The value paragraph of a KPI tile — the first `<p>` under the tile root. */
function tileValue(label: string): string {
  const root = screen.getByText(label).parentElement?.parentElement;
  return root?.querySelector("p")?.textContent ?? "";
}

function emit(readings: TelemetryReading[]): void {
  const handler = mocks.handlers.get("telemetry");
  expect(handler, "the view registered no telemetry handler").toBeDefined();
  act(() => {
    handler?.({ readings });
  });
}

function reading(assetId: string, pointKey: string, value: number): TelemetryReading {
  return { assetId, pointKey, value, unit: "kW", time: new Date().toISOString() };
}

const PARTIAL_LINE = /Partial scope/;

/** W1a — one panel heading per domain, in DTO order. */
export async function domainHeadingsInDtoOrder(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(headings).toEqual(["HVAC", "Electrical"]);
}

/** W1b — each panel states its asset count. */
export async function domainPanelsCountTheirAssets(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  const hvac = screen.getByRole("heading", { level: 2, name: "HVAC" }).closest("section");
  expect(hvac?.textContent).toContain("1 asset");
  expect(hvac?.textContent).not.toContain("1 assets");
}

/** W2a — the card shows the first four rows. */
export async function cardShowsFourRows(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  expect(rowsOf("AHU-01")).toHaveLength(4);
  expect(within(card("AHU-01")).queryByText("Point five")).toBeNull();
}

/** W2b — "All points" expands the card inline to every row (OQ2). */
export async function allPointsExpandsTheCard(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  act(() => {
    within(card("AHU-01")).getByRole("button", { name: "All points" }).click();
  });
  expect(rowsOf("AHU-01")).toHaveLength(6);
}

/** W2c — "Fewer points" collapses it back to four (OQ2). */
export async function fewerPointsCollapsesTheCard(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  act(() => {
    within(card("AHU-01")).getByRole("button", { name: "All points" }).click();
  });
  expect(rowsOf("AHU-01"), "control: expanded first").toHaveLength(6);
  act(() => {
    within(card("AHU-01")).getByRole("button", { name: "Fewer points" }).click();
  });
  expect(rowsOf("AHU-01")).toHaveLength(4);
}

/** W3 — the six KPI tiles read the location dashboard (D5). */
export async function kpiTilesReadTheLocationDashboard(): Promise<void> {
  renderView();
  await screen.findByText("123.4");
  expect(tileValue("Total load")).toBe("123.4kW");
  expect(tileValue("Assets fresh")).toBe("2 / 5");
  expect(tileValue("Open alarms")).toBe("7");
  expect(tileValue("Critical alarms")).toBe("6");
  expect(tileValue("Open work orders")).toBe("4");
  expect(tileValue("RTUs")).toBe("3");
}

/** W4a — a partial scope prints the partial-scope line. */
export async function partialScopeShowsTheLine(): Promise<void> {
  renderView({ dashboard: kpis("partial") });
  await screen.findByText("123.4");
  expect(screen.getByText(PARTIAL_LINE)).toBeInTheDocument();
}

/** W4b — a full scope does not; the KPIs rendered, so the absence is not a pending read. */
export async function fullScopeHidesTheLine(): Promise<void> {
  renderView({ dashboard: kpis("full") });
  await screen.findByText("123.4");
  expect(screen.queryByText(PARTIAL_LINE)).toBeNull();
}

/** W5a — a reading for a tracked point changes its row. */
export async function trackedReadingChangesItsRow(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  expect(rowText("AHU-01", "Load"), "control: the seeded value").toContain("11");
  emit([reading(AHU_ID, "kw", 99)]);
  expect(rowText("AHU-01", "Load")).toContain("99");
}

/** W5b — a reading for an asset the view does not hold changes nothing. */
export async function unknownAssetReadingChangesNothing(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  emit([reading(STRANGER_ID, "kw", 55)]);
  expect(rowText("AHU-01", "Load")).toContain("11");
  expect(screen.queryByText("55")).toBeNull();
  emit([reading(AHU_ID, "kw", 98)]);
  expect(rowText("AHU-01", "Load"), "positive control: the handler is live").toContain("98");
}

/** W5c — an unregistered key on a held asset moves neither a row nor the status (D3). */
export async function unregisteredKeyChangesNothing(): Promise<void> {
  renderView();
  await screen.findByText("PCC-01");
  emit([reading(PCC_ID, "not_registered", 77)]);
  expect(pillOf("PCC-01")).toBe("None");
  expect(screen.queryByText("77")).toBeNull();
  emit([reading(PCC_ID, "kwh_total", 42)]);
  expect(pillOf("PCC-01"), "positive control: a registered key goes live").toBe("Live");
  expect(rowText("PCC-01", "Energy")).toContain("42");
}

/** W6 — with no socket traffic, `Live` turns `Stale` on the staleness tick. */
export async function liveTurnsStaleOnTheTick(): Promise<void> {
  vi.useFakeTimers({ now: Date.parse("2026-09-26T10:00:00.000Z") });
  // The KPI read hangs, so nothing but the staleness tick re-renders the view.
  renderView({ view: siteView(5_000), dashboard: "hang" });
  await advance(0);
  expect(pillOf("AHU-01"), "control: live at first paint").toBe("Live");
  await advance(15_000);
  expect(pillOf("AHU-01"), "control: live 20 s after the sample").toBe("Live");
  await advance(15_000);
  expect(pillOf("AHU-01")).toBe("Stale");
}

/** W7a — a point with no sample prints the dash. */
export async function nullLatestPrintsTheDash(): Promise<void> {
  renderView();
  await screen.findByText("PCC-01");
  expect(rowText("PCC-01", "Energy")).toContain("—");
}

/** W7b — an asset with no sample reads `None`. */
export async function noSampleReadsNone(): Promise<void> {
  renderView();
  await screen.findByText("PCC-01");
  expect(pillOf("PCC-01")).toBe("None");
  expect(pillOf("AHU-01"), "positive control: a sampled asset is not None").toBe("Live");
}

const VIEW_ERROR = "Could not load the site view.";
const KPI_ERROR = "Could not load the site KPIs.";

/** W8a — the generated read's error line; the KPI error line is absent. */
export async function viewReadErrorLine(): Promise<void> {
  renderView({ view: "reject" });
  expect(await screen.findByText(VIEW_ERROR)).toBeInTheDocument();
  await screen.findByText("123.4");
  expect(screen.queryByText(KPI_ERROR)).toBeNull();
}

/** W8b — the KPI read's error line; the view error line is absent. */
export async function kpiReadErrorLine(): Promise<void> {
  renderView({ dashboard: "reject" });
  expect(await screen.findByText(KPI_ERROR)).toBeInTheDocument();
  await screen.findByText("AHU-01");
  expect(screen.queryByText(VIEW_ERROR)).toBeNull();
}

/** W9a — one socket, on `/ws/telemetry`, with the session token. */
export async function oneSocketWithTheToken(): Promise<void> {
  renderView();
  await screen.findByText("AHU-01");
  await screen.findByText("123.4");
  expect(mocks.io).toHaveBeenCalledTimes(1);
  const [url, options] = mocks.io.mock.calls[0] as [string, { auth?: { token?: string } }];
  expect(url).toMatch(/\/ws\/telemetry$/);
  expect(options.auth?.token).toBe(TOKEN);
}

/** W9b — unmounting disconnects that socket. */
export async function unmountDisconnects(): Promise<void> {
  const { unmount } = renderView();
  await screen.findByText("AHU-01");
  expect(mocks.disconnect, "control: still connected while mounted").not.toHaveBeenCalled();
  unmount();
  expect(mocks.disconnect).toHaveBeenCalledTimes(1);
}

/** Empty state — no domain in scope says so. */
export async function noDomainsSaysSo(): Promise<void> {
  renderView({ view: { locationId: LOCATION_ID, asOf: new Date().toISOString(), domains: [] } });
  expect(await screen.findByText("No assets in your access scope at this site.")).toBeInTheDocument();
}

/** Loading state — a pending read says loading, not empty. */
export async function pendingReadSaysLoading(): Promise<void> {
  renderView({ view: "hang" });
  await screen.findByText("123.4");
  expect(screen.getByText("Loading the site view…")).toBeInTheDocument();
  expect(screen.queryByText("No assets in your access scope at this site.")).toBeNull();
}

const ROW_ASSET_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function rowAsset(ageMs: number): GeneratedSiteAssetDto {
  return {
    id: ROW_ASSET_ID,
    code: "ROW-01",
    name: "Row asset",
    domain: "electrical",
    latestTelemetryAt: isoAgo(ageMs),
    freshness: ageMs > 25_000 ? "stale" : "live",
    points: [point("kw", "Load", 42, ageMs)],
  };
}

function rowView(ageMs: number): GeneratedSiteViewDto {
  return {
    locationId: LOCATION_ID,
    asOf: new Date().toISOString(),
    domains: [{ code: "electrical", label: "Electrical", assets: [rowAsset(ageMs)] }],
  };
}

function valueCell(code: string): HTMLElement {
  return within(card(code)).getByTestId("point-value");
}

/**
 * W10a — a point row whose own reading is stale (ADR 0076 Amendment 1, owner
 * ruling 2026-09-26) still shows its value, dimmed.
 */
export async function staleRowShowsValueDimmed(): Promise<void> {
  renderView({ view: rowView(60_000) });
  await screen.findByText("ROW-01");
  const cell = valueCell("ROW-01");
  expect(cell.textContent).toContain("42");
  expect(cell.className).toContain("opacity-50");
}

/** W10b — a live row's value carries no dimmed class; positive control first. */
export async function liveRowShowsValueUndimmed(): Promise<void> {
  renderView({ view: rowView(5_000) });
  await screen.findByText("ROW-01");
  const cell = valueCell("ROW-01");
  expect(cell.textContent, "control: the value is present").toContain("42");
  expect(cell.className).not.toContain("opacity-50");
}

// ------------------------------------------------ W12 — future-dated samples
//
// A producer whose clock runs ahead stamps its samples in the future. The
// F4.37 clamp caps a sample's time at the instant it ARRIVED (the generated
// read's `dataUpdatedAt`, or the socket message's receipt), once. A clamp
// taken at render instead caps it at "now" on every render, so a silent
// device reads Live forever. Each case starts the fake clock at T0, the read
// resolves at T0, and the device then says nothing: the first render past
// T0 + 25 s (the 30 s tick) must read Stale / dimmed. The 30 s tick is also
// when the generated read refetches the same payload, which must not re-clamp
// the same sample to the refetch instant (W12c).

const T0 = Date.parse("2026-09-26T10:00:00.000Z");

/** The `AHU-01` view with its `latestTelemetryAt` and every sample `aheadMs` in the future. */
function futureAhuView(aheadMs: number): GeneratedSiteViewDto {
  const time = new Date(Date.now() + aheadMs).toISOString();
  const asset = ahu(0);
  return {
    locationId: LOCATION_ID,
    asOf: new Date().toISOString(),
    domains: [
      {
        code: "hvac",
        label: "HVAC",
        assets: [
          {
            ...asset,
            latestTelemetryAt: time,
            points: asset.points.map((p) => ({ ...p, latest: p.latest === null ? null : { ...p.latest, time } })),
          },
        ],
      },
    ],
  };
}

/** The `PCC-01` view only: no seeded sample at all, so every sample it shows came from the socket. */
function pccOnlyView(): GeneratedSiteViewDto {
  return {
    locationId: LOCATION_ID,
    asOf: new Date().toISOString(),
    domains: [{ code: "electrical", label: "Electrical", assets: [pcc()] }],
  };
}

function valueCellOf(code: string, name: string): HTMLElement {
  const row = rowsOf(code).find((r) => within(r).queryByRole("rowheader", { name }) !== null);
  if (!row) throw new Error(`${code} has no row named ${name}`);
  return within(row).getByTestId("point-value");
}

async function renderFutureSeed(): Promise<void> {
  vi.useFakeTimers({ now: T0 });
  // The KPI read hangs, so only the tick and the 30 s refetch re-render the view.
  renderView({ view: futureAhuView(60_000), dashboard: "hang" });
  await advance(0);
}

async function renderFutureSocketReading(): Promise<void> {
  vi.useFakeTimers({ now: T0 });
  renderView({ view: pccOnlyView(), dashboard: "hang" });
  await advance(0);
  emit([{ assetId: PCC_ID, pointKey: "kwh_total", value: 42, unit: "kWh", time: new Date(T0 + 120_000).toISOString() }]);
}

/** W12a — a future-dated seeded sample: Live at 20 s, Stale by the 30 s tick. */
export async function futureSeededSampleGoesStale(): Promise<void> {
  await renderFutureSeed();
  await advance(20_000);
  expect(pillOf("AHU-01"), "control: live 20 s after the read arrived").toBe("Live");
  await advance(10_000);
  expect(pillOf("AHU-01")).toBe("Stale");
}

/** W12b — the same sample's row is dimmed by the 30 s tick; undimmed at 20 s. */
export async function futureSeededRowGoesDimmed(): Promise<void> {
  await renderFutureSeed();
  await advance(20_000);
  expect(valueCellOf("AHU-01", "Load").className, "control: undimmed at 20 s").not.toContain("opacity-50");
  await advance(10_000);
  expect(valueCellOf("AHU-01", "Load").className).toContain("opacity-50");
}

/** W12c — two refetches of the same payload (30 s, 60 s) do not revive it: still Stale at 65 s. */
export async function identicalRefetchDoesNotRevive(): Promise<void> {
  await renderFutureSeed();
  await advance(65_000);
  expect(mocks.fetchGeneratedSiteView, "control: the read refetched twice").toHaveBeenCalledTimes(3);
  expect(pillOf("AHU-01")).toBe("Stale");
}

/** W12d — a future-dated socket reading: Live at 20 s, Stale by the 30 s tick. */
export async function futureSocketReadingGoesStale(): Promise<void> {
  await renderFutureSocketReading();
  await advance(20_000);
  expect(pillOf("PCC-01"), "control: live 20 s after the reading arrived").toBe("Live");
  await advance(10_000);
  expect(pillOf("PCC-01")).toBe("Stale");
}

/** W12e — that reading's row is dimmed by the 30 s tick; undimmed at 20 s. */
export async function futureSocketRowGoesDimmed(): Promise<void> {
  await renderFutureSocketReading();
  await advance(20_000);
  expect(valueCellOf("PCC-01", "Energy").className, "control: undimmed at 20 s").not.toContain("opacity-50");
  await advance(10_000);
  expect(valueCellOf("PCC-01", "Energy").className).toContain("opacity-50");
}

/**
 * One asset with a point sampled 5 s ago ("Fresh") and one sampled 60 s ago
 * ("Old"): the asset itself is Live (its newest sample is 5 s old), so only a
 * per-row judgement can dim "Old" and leave "Fresh" alone. A single-point
 * asset (W10) cannot tell a row's own staleness from the asset's.
 */
function mixedAgeView(): GeneratedSiteViewDto {
  return {
    locationId: LOCATION_ID,
    asOf: new Date().toISOString(),
    domains: [
      {
        code: "electrical",
        label: "Electrical",
        assets: [
          {
            id: ROW_ASSET_ID,
            code: "ROW-01",
            name: "Row asset",
            domain: "electrical",
            latestTelemetryAt: isoAgo(5_000),
            freshness: "live",
            points: [point("fresh", "Fresh", 51, 5_000), point("old", "Old", 52, 60_000)],
          },
        ],
      },
    ],
  };
}

/** W13a — on a Live asset, the 60 s row is dimmed (the pill reads Live: the control). */
export async function oldRowOnALiveAssetIsDimmed(): Promise<void> {
  renderView({ view: mixedAgeView() });
  await screen.findByText("ROW-01");
  expect(pillOf("ROW-01"), "control: the asset is Live").toBe("Live");
  expect(valueCellOf("ROW-01", "Old").className).toContain("opacity-50");
}

/** W13b — on the same asset, the 5 s row is not dimmed (its value is present: the control). */
export async function freshRowOnTheSameAssetIsNotDimmed(): Promise<void> {
  renderView({ view: mixedAgeView() });
  await screen.findByText("ROW-01");
  const cell = valueCellOf("ROW-01", "Fresh");
  expect(cell.textContent, "control: the value is present").toContain("51");
  expect(cell.className).not.toContain("opacity-50");
}

/** W11 — the generated site view refetches every 30 s (a new asset or rank must appear). */
export async function generatedReadRefetchesEvery30s(): Promise<void> {
  vi.useFakeTimers({ now: Date.parse("2026-09-26T10:00:00.000Z") });
  renderView();
  await advance(0);
  expect(mocks.fetchGeneratedSiteView, "control: fetched once on mount").toHaveBeenCalledTimes(1);
  await advance(30_000);
  expect(mocks.fetchGeneratedSiteView).toHaveBeenCalledTimes(2);
}
