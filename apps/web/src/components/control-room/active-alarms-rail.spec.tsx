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
  { code: "info", label: "Info", tone: "info", rank: 10, count: 1 },
  { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 2 },
  { code: "high", label: "High", tone: "warning", rank: 25, count: 3 },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 4 },
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
    assetName: "CR Main Incomer",
    siteName: "SMOC",
    ...overrides,
  };
}

type Setup = {
  ids?: string[];
  items?: AlarmListItem[];
  assetsResolving?: boolean;
};

function renderRail({ ids = IDS, items = [alarm(1)], assetsResolving = false }: Setup = {}): void {
  mocks.handlers.clear();
  mocks.fetchActiveAlarms.mockImplementation(
    (): Promise<AlarmsListResponse> => Promise.resolve({ items, nextCursor: null }),
  );
  mocks.fetchAlarmSummary.mockImplementation(
    (): Promise<AlarmSummaryResponse> => Promise.resolve({ items: SUMMARY_ITEMS, total: 10 }),
  );
  mocks.fetchVocabularies.mockImplementation(
    (): Promise<VocabulariesResponse> =>
      Promise.resolve({
        ruleCategories: [],
        assetDomains: [],
        alarmSeverities: SEVERITIES,
        alarmSkills: [],
      } as unknown as VocabulariesResponse),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActiveAlarmsRail assetIds={ids} assetsResolving={assetsResolving} />
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
  await waitFor(() => expect(pill.className).toContain("bg-amber-100"));
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
  renderRail({ ids: [], assetsResolving: true });
  expect(screen.getByText("Loading alarms…")).toBeInTheDocument();
  expect(screen.queryByText("No active alarms")).not.toBeInTheDocument();
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
