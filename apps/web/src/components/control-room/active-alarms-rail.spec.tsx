import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  AlarmListItem,
  AlarmSeverityCount,
  AlarmSeverityDto,
  AlarmSocketEvent,
  AlarmSummaryResponse,
  AlarmsListResponse,
  VocabulariesResponse,
} from "@bms/shared";

import { ActiveAlarmsRail } from "./active-alarms-rail";

/**
 * `F3.28` Task 1.7 — the `/cr-overview` alarms rail (ADR 0074 decision 4).
 *
 * The two fetches and the vocabulary are replaced by `vi.fn`s, and the socket
 * transport by a stub that keeps the `alarm` handler so a test can fire an
 * event. The invalidation claims are asserted on their *effect* — each read
 * fetches a second time — rather than on `invalidateQueries`' arguments, so a
 * key that no longer matches the query it names is what reddens them.
 */

const mocks = vi.hoisted(() => ({
  fetchActiveAlarms: vi.fn(),
  fetchAlarmSummary: vi.fn(),
  fetchVocabularies: vi.fn(),
  handlers: new Map<string, (event: unknown) => void>(),
}));

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (name: string, handler: (event: unknown) => void) => {
      mocks.handlers.set(name, handler);
    },
    disconnect: () => undefined,
  }),
}));

vi.mock("../../api/alarms", () => ({
  fetchActiveAlarms: mocks.fetchActiveAlarms,
  fetchAlarmSummary: mocks.fetchAlarmSummary,
}));

vi.mock("../../api/vocabularies", () => ({
  vocabulariesQueryKey: ["vocabularies"],
  fetchVocabularies: mocks.fetchVocabularies,
}));

const IDS = ["asset-a", "asset-b"];

/** `high` is client ask `B9`'s level: rank 25, tone `warning` (ADR 0032). */
const SEVERITIES: AlarmSeverityDto[] = [
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
  { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
  { code: "high", label: "High", tone: "warning", rank: 25, active: true },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
];

/** Ascending rank, as `GET /alarms/summary` returns it. */
const SUMMARY_ITEMS: AlarmSeverityCount[] = [
  { code: "info", label: "Info", tone: "info", rank: 10, count: 1, unacknowledged: 1 },
  { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 2, unacknowledged: 2 },
  { code: "high", label: "High", tone: "warning", rank: 25, count: 3, unacknowledged: 3 },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 4, unacknowledged: 4 },
];

function alarm(index: number, overrides: Partial<AlarmListItem> = {}): AlarmListItem {
  return {
    id: `alarm-${index}`,
    assetId: "asset-a",
    ruleKey: null,
    ruleId: null,
    severity: "critical",
    message: `Alarm message ${index}`,
    raisedAt: new Date(Date.UTC(2026, 8, 24, 10, 60 - index)).toISOString(),
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: "CR-Q1",
    assetRtuName: "RTU 1",
    assetLocationName: "Plant A",
    assetName: "CR Main Incomer",
    siteName: "SMOC",
    source: "rule",
    rtuId: null,
    rtuCode: null,
    severityRank: 30,
    suppressed: false,
    maintenanceWindowId: null,
    unsuppressedAt: null,
    locationName: null,
    ...overrides,
  };
}

type Setup = {
  ids?: string[];
  items?: AlarmListItem[];
  assetsStatus?: "pending" | "success" | "error";
  /** `F3.66`: render the organization-scoped rail instead of the id-scoped one. */
  organizationId?: string;
};

const ORG = "44444444-4444-4444-8444-444444444444";

function renderRail({
  ids = IDS,
  items = [alarm(1)],
  assetsStatus = "success",
  organizationId,
}: Setup = {}): void {
  mocks.handlers.clear();
  mocks.fetchActiveAlarms.mockImplementation(
    (): Promise<AlarmsListResponse> => Promise.resolve({ items, nextCursor: null }),
  );
  mocks.fetchAlarmSummary.mockImplementation(
    (): Promise<AlarmSummaryResponse> => Promise.resolve({ items: SUMMARY_ITEMS, total: 10, suppressed: 0 }),
  );
  mocks.fetchVocabularies.mockImplementation(
    (): Promise<VocabulariesResponse> =>
      Promise.resolve({
        ruleCategories: [],
        assetDomains: [],
        alarmSeverities: SEVERITIES,
        alarmSkills: [],
        switchingStates: [],
      } as unknown as VocabulariesResponse),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {organizationId !== undefined ? (
          <ActiveAlarmsRail organizationId={organizationId} />
        ) : (
          <ActiveAlarmsRail assetIds={ids} assetsStatus={assetsStatus} />
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fireAlarmEvent(): void {
  const handler = mocks.handlers.get("alarm");
  expect(handler, "the rail registered no `alarm` handler").toBeTruthy();
  const event: AlarmSocketEvent = { type: "created", alarm: alarm(99) };
  act(() => {
    handler?.(event);
  });
}

/** Nine active alarms: the eighth renders and the ninth does not. */
export async function rendersEightRowsAndNoNinth(): Promise<void> {
  renderRail({ items: Array.from({ length: 9 }, (_, i) => alarm(i + 1)) });
  expect(await screen.findByText("Alarm message 8")).toBeInTheDocument();
  expect(screen.queryByText("Alarm message 9")).toBeNull();
}

/** `high` at rank 25 with tone `warning` draws the warning (amber) pill. */
export async function pillToneComesFromTheVocabulary(): Promise<void> {
  renderRail({ items: [alarm(1, { severity: "high" })] });
  const pill = await screen.findByText("high");
  // The row can render before the vocabulary lands; until then the pill is grey.
  await waitFor(() => expect(pill.className).toContain("bg-warning-wash-strong"));
}

/** The Alarm Summary tab lists every severity's count, most urgent first. */
export async function summaryTabListsCountsMostUrgentFirst(): Promise<void> {
  renderRail();
  await userEvent.click(screen.getByRole("tab", { name: "Alarm Summary" }));
  const list = await screen.findByRole("list", { name: "Active alarms by severity" });
  const rows = within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(rows).toEqual(["Critical4", "High3", "Warning2", "Info1"]);
}

/** The Alarm Summary tab ends with the total. */
export async function summaryTabShowsTheTotal(): Promise<void> {
  renderRail();
  await userEvent.click(screen.getByRole("tab", { name: "Alarm Summary" }));
  expect(await screen.findByTestId("alarm-summary-total")).toHaveTextContent("10");
}

/** With ids, the active list is fetched for exactly those ids. */
export async function fetchesTheActiveListForTheGivenIds(): Promise<void> {
  renderRail();
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledWith(IDS));
}

/** A `/ws/alarms` event refetches the active list. */
export async function socketEventRefetchesTheActiveList(): Promise<void> {
  renderRail();
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledTimes(1));
  fireAlarmEvent();
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledTimes(2));
}

/** A `/ws/alarms` event refetches the severity summary. */
export async function socketEventRefetchesTheSummary(): Promise<void> {
  renderRail();
  await waitFor(() => expect(mocks.fetchAlarmSummary).toHaveBeenCalledTimes(1));
  fireAlarmEvent();
  await waitFor(() => expect(mocks.fetchAlarmSummary).toHaveBeenCalledTimes(2));
}

/** No ids: the active list is never fetched. */
export async function emptyIdsFetchNoActiveList(): Promise<void> {
  renderRail({ ids: [] });
  expect(await screen.findByText("No assets in scope")).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.fetchActiveAlarms).not.toHaveBeenCalled();
}

/** No ids: the summary is never fetched. */
export async function emptyIdsFetchNoSummary(): Promise<void> {
  renderRail({ ids: [] });
  expect(await screen.findByText("No assets in scope")).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.fetchAlarmSummary).not.toHaveBeenCalled();
}

/** Ids and an empty response: the empty state, after the fetch. */
export async function rendersTheEmptyStateForNoActiveAlarms(): Promise<void> {
  renderRail({ items: [] });
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("No active alarms")).toBeInTheDocument();
}

/**
 * No ids yet because the page's assets are still resolving: the rail says it
 * is loading, never "No active alarms" — it has not asked the server.
 */
export async function resolvingIdsSayLoadingNotNone(): Promise<void> {
  renderRail({ ids: [], assetsStatus: "pending" });
  expect(screen.getByText("Loading alarms…")).toBeInTheDocument();
  expect(screen.queryByText("No active alarms")).not.toBeInTheDocument();
}

/**
 * No ids because the page's asset read failed: the rail says so, never
 * "Loading alarms…" — a failed read does not retry into an answer.
 */
export function failedAssetReadSaysUnavailable(): void {
  renderRail({ ids: [], assetsStatus: "error" });
  expect(screen.getByText("Alarms unavailable.")).toBeInTheDocument();
}

/** The positive control beside the error case: a failed read is not "loading". */
export function failedAssetReadDoesNotSayLoading(): void {
  renderRail({ ids: [], assetsStatus: "error" });
  expect(screen.queryByText("Loading alarms…")).not.toBeInTheDocument();
}

/**
 * With ids but the network paused, the read is pending and not fetching:
 * `isLoading` is false there, so a rail gated on it fell through to "No
 * active alarms" before it had an answer. The wrapper restores the online
 * state in `afterEach`, so a red run cannot leak it into a later `it()`.
 */
export function pausedActiveTabSaysLoadingNotNone(): void {
  onlineManager.setOnline(false);
  renderRail();
  expect(screen.getByText("Loading alarms…")).toBeInTheDocument();
  expect(screen.queryByText("No active alarms")).not.toBeInTheDocument();
}

/** The same paused read on the Alarm Summary tab: loading, never "No active alarms". */
export async function pausedSummaryTabSaysLoadingNotNone(): Promise<void> {
  onlineManager.setOnline(false);
  renderRail();
  await userEvent.click(screen.getByRole("tab", { name: "Alarm Summary" }));
  expect(screen.getByText("Loading alarms…")).toBeInTheDocument();
  expect(screen.queryByText("No active alarms")).not.toBeInTheDocument();
}

/** "View All" links to the alarms page. */
export function viewAllLinksToTheAlarmsPage(): void {
  renderRail();
  expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/alarms");
}

/*
 * `F3.66` (step-5 fix) — the organization-scoped rail. It asks by
 * `organizationId`, never by ids; the id-scoped items above are the F3.28
 * path's unchanged control.
 */

/** Given an organization, the active list is fetched for exactly `{ organizationId }` — no ids. */
export async function fetchesTheActiveListForTheOrganization(): Promise<void> {
  renderRail({ organizationId: ORG });
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledWith({ organizationId: ORG }));
}

/** Given an organization, the summary is fetched for exactly `{ organizationId }` — no ids. */
export async function fetchesTheSummaryForTheOrganization(): Promise<void> {
  renderRail({ organizationId: ORG });
  await waitFor(() => expect(mocks.fetchAlarmSummary).toHaveBeenCalledWith({ organizationId: ORG }));
}

/** Given an organization and no ids, the rail renders its rows — never "No assets in scope". */
export async function theOrganizationRailRendersItsRows(): Promise<void> {
  renderRail({ organizationId: ORG });
  expect(await screen.findByText("Alarm message 1")).toBeInTheDocument();
}

/** A `/ws/alarms` event refetches the organization's active list too. */
export async function socketEventRefetchesTheOrganizationsActiveList(): Promise<void> {
  renderRail({ organizationId: ORG });
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledTimes(1));
  fireAlarmEvent();
  await waitFor(() => expect(mocks.fetchActiveAlarms).toHaveBeenCalledTimes(2));
}

/**
 * `F4.316` PR 2 (ADR 0111): the innermost element whose whole text is `text` — the asset label is
 * the code and a `· where` span, so no single text node holds it.
 */
function byWholeText(container: HTMLElement, text: string): HTMLElement {
  return within(container).getByText(
    (_content, element) =>
      element !== null &&
      element.textContent === text &&
      Array.from(element.children).every((child) => child.textContent !== text),
  );
}

/** The rail row holding `message`. */
async function railRow(message: string): Promise<HTMLElement> {
  const cell = await screen.findByText(message);
  const row = cell.closest("tr");
  if (row === null) throw new Error(`"${message}" is not in a table row`);
  return row;
}

/** `F4.316` PR 2 (ADR 0111): the Asset cell reads `<code> · <RTU>`. */
export async function theAssetCellNamesTheRtu(): Promise<void> {
  renderRail({ items: [alarm(1)] });
  expect(byWholeText(await railRow("Alarm message 1"), "CR-Q1 · RTU 1")).toBeInTheDocument();
}

/** With no RTU the location names the asset: `<code> · <location>`. */
export async function theAssetCellFallsBackToTheLocation(): Promise<void> {
  renderRail({ items: [alarm(1, { assetRtuName: null })] });
  expect(byWholeText(await railRow("Alarm message 1"), "CR-Q1 · Plant A")).toBeInTheDocument();
}

/** The `· where` part wraps rather than truncating. */
export async function theAssetCellsWherePartWraps(): Promise<void> {
  renderRail({ items: [alarm(1)] });
  const where = within(await railRow("Alarm message 1")).getByText("· RTU 1");
  expect(where).not.toHaveClass("truncate");
  expect(where).toHaveClass("whitespace-normal");
}

/**
 * The rail's row is two columns, Time and Alarm. In a ~320 px rail the time, a 20-character
 * code (which never wraps, ADR 0111 decision 4) and a severity pill side by side are wider than
 * the card, so the pill drew outside it. The Alarm cell stacks the label over the message and
 * the pill, which fits.
 */
export async function theRowHasTwoColumns(): Promise<void> {
  renderRail({ items: [alarm(1)] });
  const row = await railRow("Alarm message 1");
  const table = row.closest("table");
  if (table === null) throw new Error("no table");
  expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Time", "Alarm"]);
  expect(within(row).getAllByRole("cell")).toHaveLength(2);
}

/** The Alarm cell holds the asset label, the message and the severity pill. */
export async function theAlarmCellHoldsLabelMessageAndPill(): Promise<void> {
  renderRail({ items: [alarm(1)] });
  const alarmCell = within(await railRow("Alarm message 1")).getAllByRole("cell")[1];
  expect(byWholeText(alarmCell, "CR-Q1 · RTU 1")).toBeInTheDocument();
  expect(within(alarmCell).getByText("Alarm message 1")).toBeInTheDocument();
  expect(within(alarmCell).getByText("critical")).toBeInTheDocument();
}

/** The code stays on one line (ADR 0111 decision 4); only the `· where` part wraps. */
export async function theCodeStaysOnOneLine(): Promise<void> {
  renderRail({ items: [alarm(1)] });
  const code = within(await railRow("Alarm message 1")).getByText("CR-Q1");
  expect(code).toHaveClass("whitespace-nowrap");
}

/**
 * `F3.16` (plan B6, ADR 0127 decision 12): a device alarm has no asset — the rail names
 * its RTU (`RTU <code>`) or the ingest host where the asset label would be, and a rule
 * alarm in the same feed renders as before.
 */
export async function aDeviceAlarmNamesItsRtuOrTheIngestHost(): Promise<void> {
  const noAsset = {
    assetId: null,
    assetCode: null,
    assetRtuName: null,
    assetLocationName: null,
    assetName: null,
    siteName: null,
  };
  renderRail({
    items: [
      alarm(1, { ...noAsset, source: "rtu_comms", rtuId: "rtu-7", rtuCode: "RTU-07", message: "Communication lost: Pump house" }),
      alarm(2, { ...noAsset, source: "ingest_host", message: "Ingest host not reporting" }),
      alarm(3),
    ],
  });
  expect(byWholeText(await railRow("Communication lost: Pump house"), "RTU RTU-07")).toBeInTheDocument();
  expect(byWholeText(await railRow("Ingest host not reporting"), "Ingest host")).toBeInTheDocument();
  expect(byWholeText(await railRow("Alarm message 3"), "CR-Q1 · RTU 1")).toBeInTheDocument();
  expect((await railRow("Ingest host not reporting")).textContent).not.toMatch(/null/);
}
