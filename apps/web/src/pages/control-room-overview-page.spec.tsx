import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  AccessibleScope,
  AlarmListItem,
  AlarmSummaryResponse,
  AlarmsListResponse,
  RuleListItem,
} from "@bms/shared";

import {
  CR_BREAKERS,
  CR_TRACKED_ASSET_CODES,
} from "../components/live-svg/control-room-bindings";
import { emptySlice, type SchematicTelemetrySlice } from "../lib/schematic-telemetry";
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
  fetchActiveAlarms: vi.fn(),
  fetchAlarmSummary: vi.fn(),
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
      idByCode: state.idByCode,
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
};

function renderPage({ telemetry = liveTelemetry(), rules = [], scope = GLOBAL_SCOPE }: Setup = {}): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.telemetry = telemetry;
  state.rules = rules;
  state.fetchActiveAlarms.mockImplementation(
    (): Promise<AlarmsListResponse> => Promise.resolve({ items: [RAIL_ALARM], nextCursor: null }),
  );
  state.fetchAlarmSummary.mockImplementation(
    (): Promise<AlarmSummaryResponse> => Promise.resolve(RAIL_SUMMARY),
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

/** A critical rule matched on a live asset: the subtitle leads with the count. */
export async function subtitleLeadsWithTheLiveCriticalCount(): Promise<void> {
  renderPage({ rules: [thresholdRule({ severity: "critical" })] });
  // The default subtitle renders first; this waits on the rules query.
  expect(await screen.findByText(/^1 ACTIVE CRITICAL · /)).toBeInTheDocument();
}
