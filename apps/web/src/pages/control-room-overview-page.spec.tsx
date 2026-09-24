import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  AccessibleScope,
  AlarmListItem,
  AlarmSummaryResponse,
  AlarmsListResponse,
  AssetRoleSummaryResponse,
  PointValuesAtInstantResponse,
  RuleListItem,
} from "@bms/shared";
import { encodePointRef } from "@bms/shared";

import {
  CR_BREAKERS,
  CR_TRACKED_ASSET_CODES,
} from "../components/live-svg/control-room-bindings";
import { emptySlice, type SchematicTelemetrySlice } from "../lib/schematic-telemetry";
import { WIDGET_ICON_PATH } from "../lib/widget-catalog";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { ControlRoomOverviewPage } from "./control-room-overview-page";

/**
 * `F3.28` Task 1.1 — a characterization spec for `/cr-overview`.
 *
 * **What this file is for.** Slice 1 of F3.28 (ADR 0074) rewrites parts of this
 * page: the rule-derived warnings panel becomes an alarms panel, and the page
 * loses lines before slice 3 adds a layout. None of the behaviour pinned here
 * is meant to move by accident, and none of it had a render test — so a change
 * to the staleness gate, to the live-only totals, or to the scope gates would
 * have been silent. Each exported function is one claim; the wrapper calls it
 * in its own `it()` so a red run names the claim.
 *
 * **The harness.** The telemetry provider is replaced whole: a Socket.IO
 * client and an assets fetch are not what this page decides, and the
 * provider's own tests own them. `useSchematicTelemetryByCode(code)` returns a
 * slice from `state.telemetry`, and the clock is pinned with fake `Date` only,
 * so `isStale` compares against `NOW` while React Query's timers stay real.
 */

const NOW = Date.parse("2026-09-24T10:00:00.000Z");

/** Well inside `FRESH_MS` (25 s). */
const LIVE_SEEN_MS = NOW - 1_000;
/** Past `FRESH_MS`: the asset has stopped reporting. */
const STALE_SEEN_MS = NOW - 30_000;

const state = vi.hoisted(() => ({
  telemetry: {} as Record<string, unknown>,
  rules: [] as unknown[],
  /** One stable map: the page memoises its alarm ids on this identity. */
  idByCode: new Map<string, string>(),
  /** Also stable: the map before `GET /assets` answers, or after it fails. */
  emptyIdByCode: new Map<string, string>(),
  /** What the mocked context hands the page on this render. */
  currentIdByCode: new Map<string, string>(),
  assetsStatus: "success" as "pending" | "success" | "error",
  fetchActiveAlarms: vi.fn(),
  fetchAlarmSummary: vi.fn(),
  fetchPointValuesAt: vi.fn(),
  fetchAssetRoleSummary: vi.fn(),
  /** The "vs yesterday" value per encoded point ref; an absent ref reads `null`. */
  priors: {} as Record<string, number | null>,
}));

/**
 * `F3.28` task 3.6 — the Key Parameters gauges mount `RadialGaugeWidget`,
 * which renders a real `echarts-for-react` chart; stubbed here as it is in
 * `key-parameters.spec.tsx`, since this file does not test gauge internals.
 */
vi.mock("echarts-for-react", () => ({
  default: () => <div data-testid="echarts-stub" />,
}));

/** Every tracked code resolves to `asset-<code>`, so the rail's ids are knowable. */
function assetIdFor(code: string): string {
  return `asset-${code}`;
}
for (const code of CR_TRACKED_ASSET_CODES) {
  state.idByCode.set(code, assetIdFor(code));
}

/**
 * The page opens no socket of its own once the provider is mocked, but the
 * app shell's imports reach the transport; an unmocked `io()` would leave a
 * live reconnect timer behind that outlives the test.
 */
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    disconnect: () => undefined,
  }),
}));

vi.mock("../api/rules", () => ({
  fetchRules: () => Promise.resolve({ items: state.rules }),
}));

/**
 * The alarms rail (`F3.28` Task 1.7) reads two endpoints and the severity
 * vocabulary. All three are replaced so no test here dials the network; the
 * rail's own spec owns their behaviour.
 */
vi.mock("../api/alarms", () => ({
  fetchActiveAlarms: state.fetchActiveAlarms,
  fetchAlarmSummary: state.fetchAlarmSummary,
}));

/**
 * `F3.28` task 2.7 — the prior read behind the tile deltas. Only
 * `fetchPointValuesAt` is replaced; the item echoes the ref as sent, which is
 * what `GET /telemetry/points/at-instant` does (`telemetry.controller.ts`).
 */
vi.mock("../api/telemetry", async (importActual) => ({
  ...(await importActual<typeof import("../api/telemetry")>()),
  fetchPointValuesAt: state.fetchPointValuesAt,
}));

/**
 * `F3.28` task 3.3 — the class strip's read. Only `fetchAssetRoleSummary` is
 * replaced; the strip's own spec owns its text rules.
 */
vi.mock("../api/assets", async (importActual) => ({
  ...(await importActual<typeof import("../api/assets")>()),
  fetchAssetRoleSummary: state.fetchAssetRoleSummary,
}));

vi.mock("../api/vocabularies", () => ({
  vocabulariesQueryKey: ["vocabularies"],
  fetchVocabularies: () =>
    Promise.resolve({
      ruleCategories: [],
      assetDomains: [],
      alarmSeverities: [
        { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
        { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
      ],
      alarmSkills: [],
    }),
}));

vi.mock("../components/live-svg/schematic-telemetry-context", async () => {
  const { emptySlice: empty } = await vi.importActual<
    typeof import("../lib/schematic-telemetry")
  >("../lib/schematic-telemetry");
  const sliceFor = (code: string | undefined) =>
    (code ? (state.telemetry[code] as SchematicTelemetrySlice | undefined) : undefined) ??
    empty();
  return {
    SchematicTelemetryProvider: ({ children }: { children: ReactNode }) => children,
    useSchematicTelemetryByCode: (code: string | undefined) => ({
      assetId: code,
      slice: sliceFor(code),
      status: "normal",
      stale: false,
    }),
    useSchematicTelemetryContext: () => ({
      idByCode: state.currentIdByCode,
      assetsStatus: state.assetsStatus,
      assetMetaById: new Map(),
      byAssetId: {},
      totalKw: null,
      staleAssets: 0,
      staleTick: 0,
    }),
  };
});

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const GLOBAL_SCOPE: AccessibleScope = {
  kind: "global",
  locations: [],
  assetGroups: [],
  assetIds: [],
};

/** An `asset_group` user who holds `electrical` and nothing else: no IT area. */
const ELECTRICAL_ONLY_SCOPE: AccessibleScope = {
  kind: "asset_group",
  locations: [],
  assetGroups: [
    { id: "g1", locationId: "l1", code: "electrical", name: "Electrical", organizationId: "o1" },
  ],
  assetIds: [],
};

function liveSlice(overrides: Partial<SchematicTelemetrySlice> = {}): SchematicTelemetrySlice {
  return { ...emptySlice(), breaker: 1, lastSeenMs: LIVE_SEEN_MS, ...overrides };
}

const MAIN_KW = 12.3;
const NET_RACK_KW = 1.2;
const VW_RACK_KW = 0.8;

/**
 * Every breaker live and closed, plus the two racks. A breaker left out would
 * read `emptySlice()` — `lastSeenMs: null`, which `isStale` treats as stale —
 * and `mergeStatus` would turn SLD Status OFFLINE on a plant that is fine.
 */
function liveTelemetry(): Record<string, SchematicTelemetrySlice> {
  const telemetry: Record<string, SchematicTelemetrySlice> = {};
  for (const row of CR_BREAKERS) {
    telemetry[row.code] = liveSlice();
  }
  telemetry["CR-Q1"] = liveSlice({ kw: MAIN_KW });
  telemetry["CR-NET-RACK"] = liveSlice({ rackKw: NET_RACK_KW });
  telemetry["CR-VW-SRV-RACK"] = liveSlice({ rackKw: VW_RACK_KW });
  return telemetry;
}

function thresholdRule(overrides: Partial<RuleListItem>): RuleListItem {
  return {
    id: "r1",
    code: "CR-Q1-KW-HIGH",
    name: "CR main incomer load high",
    description: null,
    category: "electrical",
    ruleType: "threshold",
    source: "operator_rule",
    enabled: true,
    assetId: "asset-cr-q1",
    assetCode: "CR-Q1",
    assetName: "CR Main Incomer",
    siteName: "SMOC",
    pointKey: "kw",
    operator: "gt",
    thresholdValue: 10,
    severity: "warning",
    ...overrides,
  } as unknown as RuleListItem;
}

/** One role at a worst severity, so the strip's mount shows a real item. */
const STRIP_SUMMARY: AssetRoleSummaryResponse = {
  items: [
    {
      code: "mcc",
      label: "MCCs",
      count: 4,
      worstSeverity: { code: "critical", label: "Critical", tone: "critical", rank: 30 },
      worstCount: 1,
      offlineCount: 0,
    },
  ],
};

/** A server-raised alarm; its message carries the task 1.2 breach value. */
const RAIL_ALARM: AlarmListItem = {
  id: "alarm-1",
  assetId: "asset-CR-Q1",
  ruleKey: null,
  ruleId: "r1",
  severity: "critical",
  message: "CR main incomer load high (12.3 kW)",
  raisedAt: new Date(NOW - 60_000).toISOString(),
  acknowledgedAt: null,
  acknowledgedBy: null,
  clearedAt: null,
  assetCode: "CR-Q1",
  assetName: "CR Main Incomer",
  siteName: "SMOC",
};

/** Ascending rank, as `GET /alarms/summary` returns it. */
const RAIL_SUMMARY: AlarmSummaryResponse = {
  items: [
    { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 2 },
    { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 1 },
  ],
  total: 3,
};

type Setup = {
  telemetry?: Record<string, SchematicTelemetrySlice>;
  rules?: RuleListItem[];
  scope?: AccessibleScope;
  /** The context's asset read; anything but `"success"` resolves no id. */
  assetsStatus?: "pending" | "success" | "error";
  /** Prior values by encoded point ref (`F3.28` task 2.7); none by default. */
  priors?: Record<string, number | null>;
};

function renderPage({
  telemetry = liveTelemetry(),
  rules = [],
  scope = GLOBAL_SCOPE,
  assetsStatus = "success",
  priors = {},
}: Setup = {}): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.telemetry = telemetry;
  state.rules = rules;
  state.assetsStatus = assetsStatus;
  state.currentIdByCode = assetsStatus === "success" ? state.idByCode : state.emptyIdByCode;
  state.fetchActiveAlarms.mockImplementation(
    (): Promise<AlarmsListResponse> => Promise.resolve({ items: [RAIL_ALARM], nextCursor: null }),
  );
  state.fetchAlarmSummary.mockImplementation(
    (): Promise<AlarmSummaryResponse> => Promise.resolve(RAIL_SUMMARY),
  );
  state.fetchAssetRoleSummary.mockImplementation(
    (): Promise<AssetRoleSummaryResponse> => Promise.resolve(STRIP_SUMMARY),
  );
  state.priors = priors;
  state.fetchPointValuesAt.mockImplementation(
    (refs: readonly string[], at: string): Promise<PointValuesAtInstantResponse> =>
      Promise.resolve({
        at,
        items: refs.map((pointRef) => {
          const value = state.priors[pointRef] ?? null;
          return { pointRef, time: value === null ? null : at, value, unit: null };
        }),
      }),
  );
  useAuthStore.setState({ scope });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ControlRoomOverviewPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The KPI grid. "Rule Warnings" is the one tile label that appears nowhere
 * else on the page; `KpiTile`'s label is a `span` inside a flex row inside the
 * card, so the card is the label's grandparent and the grid is its parent.
 */
function kpiGrid(): HTMLElement {
  const card = screen.getByText("Rule Warnings").parentElement?.parentElement;
  const grid = card?.parentElement;
  expect(grid, "no KPI grid around the Rule Warnings tile").toBeTruthy();
  return grid as HTMLElement;
}

/**
 * A tile read inside its own card and inside the KPI grid — "Environment",
 * for one, is also a module card, a status row and a drilldown link.
 */
function tileLabelled(label: string): HTMLElement {
  const card = within(kpiGrid()).getByText(label).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

/** The page's own content, below the app shell: the KPI grid's parent. */
function pageContent(): HTMLElement {
  return kpiGrid().parentElement as HTMLElement;
}

export const KPI_LABELS = [
  "Rule Warnings",
  "Total CR Load",
  "SLD Status",
  "Rack Load",
  "UPS Backup",
  "Environment",
] as const;

export const SECTION_HEADINGS = [
  "Single Line Diagram · Power Flow",
  "Key Parameters",
  "IT Rack Load",
  "Critical Systems Summary",
  "Energy Snapshot",
  "Environment Snapshot",
  "Quick Drilldown",
] as const;

/** The title the page renders in its header. */
export function rendersThePageTitle(): void {
  renderPage();
  expect(
    screen.getByRole("heading", { level: 1, name: "SMOC Control Room · Main Dashboard" }),
  ).toBeInTheDocument();
}

/** Six KPI tiles, in this order, and no seventh. */
export function rendersTheSixKpiLabelsInOrder(): void {
  renderPage();
  const labels = Array.from(kpiGrid().children).map(
    (card) => card.firstElementChild?.firstElementChild?.textContent,
  );
  expect(labels).toEqual([...KPI_LABELS]);
}

/** Total CR Load = main incomer kW + both racks' kW, to one decimal. */
export function totalCrLoadSumsTheMainBusAndBothRacks(): void {
  renderPage();
  // 12.3 + 1.2 + 0.8
  expect(within(tileLabelled("Total CR Load")).getByText("14.3")).toBeInTheDocument();
}

/** An enabled threshold rule that the live CR-Q1 kW breaches counts once. */
export async function ruleWarningsCountsAMatchedThresholdRule(): Promise<void> {
  renderPage({ rules: [thresholdRule({ severity: "warning" })] });
  // Before the rules query resolves the tile reads 0, so this waits on the data.
  expect(await within(tileLabelled("Rule Warnings")).findByText("1")).toBeInTheDocument();
}

/** Every breaker live and closed, no rule matched: SLD Status reads OK. */
export function sldStatusReadsOkWhenEveryBreakerIsLive(): void {
  renderPage();
  expect(within(tileLabelled("SLD Status")).getByText("OK")).toBeInTheDocument();
}

function staleMainTelemetry(): Record<string, SchematicTelemetrySlice> {
  const telemetry = liveTelemetry();
  // `kw` stays set: a stale reading is still a number, and the point is that
  // the page must not count it.
  telemetry["CR-Q1"] = liveSlice({ kw: MAIN_KW, lastSeenMs: STALE_SEEN_MS });
  return telemetry;
}

/** CR-Q1 last seen 30 s ago: SLD Status reads OFFLINE, not the breaker state. */
export function sldStatusReadsOfflineWhenTheMainIncomerIsStale(): void {
  renderPage({ telemetry: staleMainTelemetry() });
  expect(within(tileLabelled("SLD Status")).getByText("OFFLINE")).toBeInTheDocument();
}

/** CR-Q1 stale: Total CR Load is the two racks alone (ADR 0027 decision 4). */
export function totalCrLoadExcludesAStaleMainIncomer(): void {
  renderPage({ telemetry: staleMainTelemetry() });
  // 1.2 + 0.8; the frozen 12.3 is not added.
  expect(within(tileLabelled("Total CR Load")).getByText("2.0")).toBeInTheDocument();
}

/** The page's section headings, in document order and no others. */
export function rendersTheSectionHeadings(): void {
  renderPage();
  const headings = within(pageContent())
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent?.trim());
  expect(headings).toEqual([...SECTION_HEADINGS]);
}

/** Positive control for the scoped case: a global user sees the rack sum. */
export function rackLoadReadsTheRackSumUnderAGlobalScope(): void {
  renderPage();
  // 1.2 + 0.8
  expect(within(tileLabelled("Rack Load")).getByText("2.0")).toBeInTheDocument();
}

/** No IT area in scope: the Rack Load tile reads the empty dash. */
export function rackLoadReadsADashOutsideTheItScope(): void {
  renderPage({ scope: ELECTRICAL_ONLY_SCOPE });
  expect(within(tileLabelled("Rack Load")).getByText("—")).toBeInTheDocument();
}

/** No IT area in scope: the Rack Load tile says why, in its hint. */
export function rackLoadSaysItIsOutsideTheScope(): void {
  renderPage({ scope: ELECTRICAL_ONLY_SCOPE });
  expect(
    within(tileLabelled("Rack Load")).getByText("outside your asset-group scope"),
  ).toBeInTheDocument();
}

/** No IT area in scope: the IT Rack Load section is replaced by its scope message. */
export function itRackLoadSectionSaysItIsOutsideTheScope(): void {
  renderPage({ scope: ELECTRICAL_ONLY_SCOPE });
  expect(
    screen.getByText("IT Rack Load is outside your assigned asset-group scope."),
  ).toBeInTheDocument();
}

/** The alarms rail shows a server alarm's message verbatim. */
export async function alarmsRailShowsTheMessageVerbatim(): Promise<void> {
  renderPage();
  expect(await screen.findByText("CR main incomer load high (12.3 kW)")).toBeInTheDocument();
}

/** The rail's Alarm Summary tab shows the counts, most urgent first. */
export async function alarmsRailSummaryShowsTheCounts(): Promise<void> {
  renderPage();
  await userEvent.click(screen.getByRole("tab", { name: "Alarm Summary" }));
  const list = await screen.findByRole("list", { name: "Active alarms by severity" });
  const rows = within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(rows).toEqual(["Critical1", "Warning2"]);
}

/** The rail's "View All" opens the alarms page. */
export function alarmsRailViewAllLinksToTheAlarmsPage(): void {
  renderPage();
  expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/alarms");
}

/** The rail asks for this page's tracked assets, resolved through `idByCode`. */
export async function alarmsRailQueriesThePageAssetIds(): Promise<void> {
  renderPage();
  await waitFor(() =>
    expect(state.fetchActiveAlarms).toHaveBeenCalledWith(
      CR_TRACKED_ASSET_CODES.map((code) => assetIdFor(code)),
    ),
  );
}

/** The context's asset read is pending: the rail says it is loading. */
export function alarmsRailSaysLoadingWhileTheAssetsArePending(): void {
  renderPage({ assetsStatus: "pending" });
  expect(screen.getByText("Loading alarms…")).toBeInTheDocument();
}

/** The context's asset read is pending: the rail fetches no alarms — it has no ids. */
export async function alarmsRailFetchesNothingWhileTheAssetsArePending(): Promise<void> {
  renderPage({ assetsStatus: "pending" });
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.fetchActiveAlarms).not.toHaveBeenCalled();
}

/** The context's asset read failed: the rail says unavailable, not loading forever. */
export function alarmsRailSaysUnavailableWhenTheAssetsFailed(): void {
  renderPage({ assetsStatus: "error" });
  expect(screen.getByText("Alarms unavailable.")).toBeInTheDocument();
}

/** A critical rule matched on a live asset: the subtitle leads with the count. */
export async function subtitleLeadsWithTheLiveCriticalCount(): Promise<void> {
  renderPage({ rules: [thresholdRule({ severity: "critical" })] });
  // The default subtitle renders first; this waits on the rules query.
  expect(await screen.findByText(/^1 ACTIVE CRITICAL · /)).toBeInTheDocument();
}

// ---------------------------------------------------------------------------
// `F3.28` task 2.7 — "vs yesterday" deltas and icons on the KPI tiles.
//
// Refs and expected strings are literals here, never imported from
// `control-room-tiles.ts`, so a mutated ref table or constant cannot carry its
// assertion with it.
// ---------------------------------------------------------------------------

const Q1_KW = encodePointRef(assetIdFor("CR-Q1"), "kw");
const NET_RACK_KW_REF = encodePointRef(assetIdFor("CR-NET-RACK"), "rack_kw");
const VW_RACK_KW_REF = encodePointRef(assetIdFor("CR-VW-SRV-RACK"), "rack_kw");
const UPS1_BACKUP = encodePointRef(assetIdFor("CR-UPS-1"), "backup_min");
const UPS2_BACKUP = encodePointRef(assetIdFor("CR-UPS-2"), "backup_min");

/** Each Total CR Load input 10 % lower yesterday: 12.87 against a live 14.3. */
const TOTAL_PRIORS = { [Q1_KW]: 11.07, [NET_RACK_KW_REF]: 1.08, [VW_RACK_KW_REF]: 0.72 };

/** The worst backup was 50 min yesterday; with a live worst of 40 that is ↓ 20.0 %. */
const UPS_PRIORS = { [UPS1_BACKUP]: 50, [UPS2_BACKUP]: 60 };

/** `liveTelemetry()` plus both UPS units live, worst backup 40 min. */
function liveTelemetryWithUps(): Record<string, SchematicTelemetrySlice> {
  return {
    ...liveTelemetry(),
    "CR-UPS-1": liveSlice({ backupMin: 40 }),
    "CR-UPS-2": liveSlice({ backupMin: 90 }),
  };
}

/**
 * The positive control for the no-delta cases: the UPS Backup delta is data
 * the prior read produces, so once it renders the prior has settled and an
 * absent delta elsewhere is a decision, not a race.
 */
async function upsDeltaRendered(): Promise<void> {
  expect(
    await within(tileLabelled("UPS Backup")).findByText("↓ 20.0% vs yesterday"),
  ).toBeInTheDocument();
}

/** A Total CR Load prior 10 % lower renders "↑ 11.1% vs yesterday". */
export async function totalCrLoadRendersARiseAgainstALowerPrior(): Promise<void> {
  renderPage({ priors: TOTAL_PRIORS });
  expect(
    await within(tileLabelled("Total CR Load")).findByText("↑ 11.1% vs yesterday"),
  ).toBeInTheDocument();
}

/**
 * Rack Load reads its own delta, not Total CR Load's. The racks were 2.5 kW
 * yesterday (↓ 20.0 % against a live 2.0) while the whole bus was 13.57 kW
 * (↑ 5.4 % against 14.3), so a swap of the two tiles' deltas prints the wrong
 * figure on both.
 */
export async function rackLoadRendersItsOwnDelta(): Promise<void> {
  renderPage({ priors: { [Q1_KW]: 11.07, [NET_RACK_KW_REF]: 1.6, [VW_RACK_KW_REF]: 0.9 } });
  expect(
    await within(tileLabelled("Rack Load")).findByText("↓ 20.0% vs yesterday"),
  ).toBeInTheDocument();
}

/** No Total CR Load prior: the tile keeps "main bus + IT racks". */
export async function aNullPriorKeepsTheTotalCrLoadHint(): Promise<void> {
  renderPage({ telemetry: liveTelemetryWithUps(), priors: UPS_PRIORS });
  await upsDeltaRendered();
  expect(within(tileLabelled("Total CR Load")).getByText("main bus + IT racks")).toBeInTheDocument();
}

/**
 * SLD Status carries no delta. Total CR Load's delta in the same render is the
 * positive control: it proves the prior settled and a delta can render.
 */
export async function sldStatusHasNoDelta(): Promise<void> {
  renderPage({ priors: TOTAL_PRIORS });
  await within(tileLabelled("Total CR Load")).findByText("↑ 11.1% vs yesterday");
  expect(within(tileLabelled("SLD Status")).queryByText(/vs yesterday/)).not.toBeInTheDocument();
}

/** The page asks the prior for exactly its five points, in one call. */
export async function thePriorReadAsksForExactlyFiveRefs(): Promise<void> {
  renderPage();
  await waitFor(() => expect(state.fetchPointValuesAt).toHaveBeenCalled());
  expect(state.fetchPointValuesAt.mock.calls[0][0]).toEqual([
    Q1_KW,
    NET_RACK_KW_REF,
    VW_RACK_KW_REF,
    UPS1_BACKUP,
    UPS2_BACKUP,
  ]);
}

/**
 * All three Total CR Load inputs live, one without a prior: no delta. A
 * baseline over the two priors that exist (12.15) against the three-input
 * live sum (14.3) would print a false "↑ 17.7%".
 */
export async function aMissingPriorAmongLiveInputsGivesNoDelta(): Promise<void> {
  renderPage({
    telemetry: liveTelemetryWithUps(),
    priors: { ...UPS_PRIORS, [Q1_KW]: 11.07, [NET_RACK_KW_REF]: 1.08 },
  });
  await upsDeltaRendered();
  expect(within(tileLabelled("Total CR Load")).queryByText(/vs yesterday/)).not.toBeInTheDocument();
}

/** The `d` of the one icon path inside a tile, or `null` when the tile has no icon. */
function iconPathOf(tile: HTMLElement): string | null {
  const svg = tile.querySelector("svg");
  return svg ? (svg.querySelector("path")?.getAttribute("d") ?? "") : null;
}

/** Plan decision 8: Rule Warnings wears `alert`. */
export function ruleWarningsWearsTheAlertIcon(): void {
  renderPage();
  expect(iconPathOf(tileLabelled("Rule Warnings"))).toBe(WIDGET_ICON_PATH.alert);
}

/** Plan decision 8: Total CR Load wears `bolt`. */
export function totalCrLoadWearsTheBoltIcon(): void {
  renderPage();
  expect(iconPathOf(tileLabelled("Total CR Load"))).toBe(WIDGET_ICON_PATH.bolt);
}

/** Plan decision 8: Rack Load wears `bolt`. */
export function rackLoadWearsTheBoltIcon(): void {
  renderPage();
  expect(iconPathOf(tileLabelled("Rack Load"))).toBe(WIDGET_ICON_PATH.bolt);
}

/**
 * Plan decision 8: SLD Status, UPS Backup and Environment wear none. Rule
 * Warnings in the same render is the positive control for the query.
 */
export function theOtherThreeTilesWearNoIcon(): void {
  renderPage();
  expect(iconPathOf(tileLabelled("Rule Warnings")), "no icon rendered anywhere").not.toBeNull();
  expect(
    ["SLD Status", "UPS Backup", "Environment"].map((label) => iconPathOf(tileLabelled(label))),
  ).toEqual([null, null, null]);
}

// ---------------------------------------------------------------------------
// `F3.28` task 3.5 — the Diagram/List toggle on the SLD section.
//
// Every query here is scoped to the SLD section: the KPI tiles carry `svg`
// icons, and SLD Status also reads OFFLINE for a stale breaker, so a
// page-wide query would pass with the toggle or the row label broken.
// ---------------------------------------------------------------------------

/** The section headed "Single Line Diagram · Power Flow". */
function sldSection(): HTMLElement {
  const section = screen
    .getByRole("heading", { level: 2, name: "Single Line Diagram · Power Flow" })
    .closest("section");
  expect(section, "no section around the SLD heading").toBeTruthy();
  return section as HTMLElement;
}

/** The breaker table's body rows inside the SLD section; the header row is not one. */
function breakerBodyRows(): HTMLElement[] {
  return Array.from(sldSection().querySelectorAll<HTMLElement>("tbody tr"));
}

async function openListView(): Promise<void> {
  await userEvent.click(within(sldSection()).getByRole("tab", { name: "List" }));
}

/** No click: the SLD section renders the diagram `svg`. */
export function theDefaultViewIsTheDiagram(): void {
  renderPage();
  expect(sldSection().querySelector("svg")).not.toBeNull();
}

/** The List tab renders one row per breaker: twelve. */
export async function theListTabShowsTwelveBreakerRows(): Promise<void> {
  renderPage();
  await openListView();
  expect(breakerBodyRows()).toHaveLength(12);
}

/** The List tab hides the diagram. The rows are the positive control. */
export async function theListTabHidesTheDiagramSvg(): Promise<void> {
  renderPage();
  await openListView();
  expect(breakerBodyRows().length, "the List view rendered no rows").toBeGreaterThan(0);
  expect(sldSection().querySelector("svg")).toBeNull();
}

/**
 * The view is component state, never persisted: after an unmount and a fresh
 * mount the Diagram tab is selected again. The first assertion proves the
 * click took effect before the remount.
 */
export async function theViewModeDoesNotSurviveARemount(): Promise<void> {
  renderPage();
  await openListView();
  expect(
    within(sldSection()).getByRole("tab", { name: "List" }),
    "the List tab was never selected",
  ).toHaveAttribute("aria-selected", "true");
  cleanup();
  renderPage();
  expect(within(sldSection()).getByRole("tab", { name: "Diagram" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/**
 * CR-Q5 last seen 30 s ago: its List row reads OFFLINE, not CLOSED. CR-Q4,
 * live in the same render, reading CLOSED is the positive control.
 */
export async function theListViewShowsAStaleBreakerOffline(): Promise<void> {
  const telemetry = liveTelemetry();
  telemetry["CR-Q5"] = liveSlice({ current: 12, lastSeenMs: STALE_SEEN_MS });
  renderPage({ telemetry });
  await openListView();
  const rowFor = (label: string) =>
    within(sldSection()).getByText(label).closest("tr") as HTMLElement;
  expect(within(rowFor("Q4 · UPS-1 OUT")).getByText("CLOSED")).toBeInTheDocument();
  expect(within(rowFor("Q5 · UPS-2 OUT")).getByText("OFFLINE")).toBeInTheDocument();
}

/**
 * A rule on a breaker key only `/cr-sld` used to read (`frequency_hz`) turns
 * the List row WARN, as the SLD page's own table does for the same rule.
 * CR-Q4, with no rule, reading CLOSED is the positive control.
 */
export async function theListViewWarnsOnAnSldOnlyPointKey(): Promise<void> {
  const telemetry = liveTelemetry();
  telemetry["CR-Q5"] = liveSlice({ frequencyHz: 50.4 });
  renderPage({
    telemetry,
    rules: [
      thresholdRule({
        assetId: "asset-cr-q5",
        assetCode: "CR-Q5",
        pointKey: "frequency_hz",
        thresholdValue: 50.2,
      }),
    ],
  });
  await openListView();
  const rowFor = (label: string) =>
    within(sldSection()).getByText(label).closest("tr") as HTMLElement;
  expect(within(rowFor("Q4 · UPS-1 OUT")).getByText("CLOSED")).toBeInTheDocument();
  expect(within(rowFor("Q5 · UPS-2 OUT")).getByText("WARN")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------
// `F3.28` task 3.4 — the state legend is mounted on the page.
// ---------------------------------------------------------------------------

/**
 * The page's `vocabularies` mock (above) carries `warning` and `critical`;
 * the legend renders Normal, both severities, then Offline.
 */
export async function theStateLegendRendersNormalTheVocabularyAndOffline(): Promise<void> {
  renderPage();
  const legend = await screen.findByLabelText("State legend");
  await waitFor(() => expect(legend.children.length).toBeGreaterThan(2));
  expect(Array.from(legend.children).map((child) => child.textContent)).toEqual([
    "Normal",
    "Warning",
    "Critical",
    "Offline",
  ]);
}

// ---------------------------------------------------------------------------
// `F3.28` task 3.6 — the Key Parameters gauges are mounted on the page.
// ---------------------------------------------------------------------------

/** The four gauge titles all render, from the page's own telemetry slices. */
export function rendersTheFourKeyParameterGaugeTitles(): void {
  renderPage();
  expect(screen.getByText("UPS-1 Load")).toBeInTheDocument();
  expect(screen.getByText("UPS-2 Load")).toBeInTheDocument();
  expect(screen.getByText("Battery Health")).toBeInTheDocument();
  expect(screen.getByText("Main Power Factor")).toBeInTheDocument();
}

// ---------------------------------------------------------------------------
// `F3.28` task 3.7 — the capability footer is mounted on the page.
// ---------------------------------------------------------------------------

export const FOOTER_ITEMS = [
  "Real-time Monitoring",
  "Intelligent Alerts",
  "Predictive Maintenance",
  "Automated Workflows",
  "Energy & Water Optimization",
  "Sustainability Insights",
  "Mobile Ready",
] as const;

/** All seven footer items render, verbatim (`docs/ux/ion-exchange-reference-alignment.md:104`). */
export function rendersAllSevenFooterItems(): void {
  renderPage();
  for (const item of FOOTER_ITEMS) {
    expect(screen.getByText(item)).toBeInTheDocument();
  }
}


/**
 * `F3.28` task 3.3 — the class strip is mounted and reads the same ids the
 * rail reads: every tracked asset the page resolved.
 */
export async function theClassStripShowsTheRoleSummary(): Promise<void> {
  renderPage();
  expect(await screen.findByText("MCCs 4 · 1 Critical")).toBeInTheDocument();
}

export async function theClassStripQueriesThePageAssetIds(): Promise<void> {
  renderPage();
  await waitFor(() =>
    expect(state.fetchAssetRoleSummary).toHaveBeenCalledWith(
      CR_TRACKED_ASSET_CODES.map(assetIdFor),
    ),
  );
}
