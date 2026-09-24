import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type {
  AlarmSocketEvent,
  AssetRoleSummaryItem,
  AssetRoleSummaryResponse,
} from "@bms/shared";

import { AssetClassStrip } from "./asset-class-strip";

/**
 * `F3.28` Task 3.3 — the `/cr-overview` asset class strip (ADR 0074, owner
 * rulings OQ4 and OQ6).
 *
 * The fetch is a `vi.fn` and the socket transport a stub that keeps the
 * `alarm` handler, so a test can fire an event. Each item's text is compared
 * **whole**: "MCCs 4 · 1 Critical" is a substring of
 * "MCCs 4 · 1 Critical · 2 Offline", so a containment check would pass with a
 * stray offline suffix.
 *
 * The MCC fixture has `count` 4 and `worstCount` 1, so a strip that printed
 * `count` for `worstCount` reads "MCCs 4 · 4 Critical" and reddens the claim.
 */

const mocks = vi.hoisted(() => ({
  fetchAssetRoleSummary: vi.fn(),
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

vi.mock("../../api/assets", () => ({
  fetchAssetRoleSummary: mocks.fetchAssetRoleSummary,
}));

const IDS = ["asset-a", "asset-b"];

const CRITICAL = { code: "critical", label: "Critical", tone: "critical", rank: 30 } as const;

function mccs(offlineCount: number): AssetRoleSummaryItem {
  return { code: "mcc", label: "MCCs", count: 4, worstSeverity: CRITICAL, worstCount: 1, offlineCount };
}

const TRANSFORMER: AssetRoleSummaryItem = {
  code: "transformer",
  label: "Transformer",
  count: 2,
  worstSeverity: null,
  worstCount: 0,
  offlineCount: 0,
};

type Setup = {
  ids?: string[];
  answer?: () => Promise<AssetRoleSummaryResponse>;
};

function renderStrip({ ids = IDS, answer = () => Promise.resolve({ items: [] }) }: Setup = {}): void {
  mocks.handlers.clear();
  mocks.fetchAssetRoleSummary.mockImplementation(answer);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AssetClassStrip assetIds={ids} />
    </QueryClientProvider>,
  );
}

function renderItems(items: AssetRoleSummaryItem[]): void {
  renderStrip({ answer: () => Promise.resolve({ items }) });
}

/** The text of every item, in order, once the list has rendered. */
async function itemTexts(): Promise<(string | null)[]> {
  const list = await screen.findByRole("list", { name: "Asset class counts" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

/** A role with an active alarm reads its count, then how many are at the worst severity. */
export async function worstSeverityItemReadsCountThenWorstCount(): Promise<void> {
  renderItems([mccs(0)]);
  expect(await itemTexts()).toEqual(["MCCs 4 · 1 Critical"]);
}

/** A role with no active alarm reads "All Good". */
export async function noWorstSeverityReadsAllGood(): Promise<void> {
  renderItems([TRANSFORMER]);
  expect(await itemTexts()).toEqual(["Transformer 2 · All Good"]);
}

/** Offline assets add " · {n} Offline". */
export async function offlineAssetsAppendTheOfflineCount(): Promise<void> {
  renderItems([mccs(2)]);
  expect(await itemTexts()).toEqual(["MCCs 4 · 1 Critical · 2 Offline"]);
}

/** An empty answer reads "No asset classes in scope". */
export async function emptyAnswerSaysNoAssetClasses(): Promise<void> {
  renderItems([]);
  expect(await screen.findByText("No asset classes in scope")).toBeInTheDocument();
}

/** A read with no answer yet says it is loading, never "No asset classes in scope". */
export async function pendingReadSaysLoadingNotNone(): Promise<void> {
  renderStrip({ answer: () => new Promise<AssetRoleSummaryResponse>(() => undefined) });
  expect(await screen.findByText("Loading asset classes…")).toBeInTheDocument();
  expect(screen.queryByText("No asset classes in scope")).toBeNull();
}

/** A paused read (offline: pending, not fetching) says loading, never "No asset classes in scope". */
export async function pausedReadSaysLoadingNotNone(): Promise<void> {
  onlineManager.setOnline(false);
  renderItems([]);
  expect(await screen.findByText("Loading asset classes…")).toBeInTheDocument();
  expect(screen.queryByText("No asset classes in scope")).toBeNull();
}

/** A failed read says so, never "No asset classes in scope". */
export async function failedReadSaysUnavailableNotNone(): Promise<void> {
  renderStrip({ answer: () => Promise.reject(new Error("assets/role-summary 500")) });
  expect(await screen.findByText("Asset classes unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("No asset classes in scope")).toBeNull();
}

/** With ids, the read is made for exactly those ids. */
export async function fetchesForTheGivenIds(): Promise<void> {
  renderItems([TRANSFORMER]);
  await waitFor(() => expect(mocks.fetchAssetRoleSummary).toHaveBeenCalledWith(IDS));
}

/** No ids: the read is never made. */
export async function emptyIdsFetchNothing(): Promise<void> {
  renderStrip({ ids: [] });
  expect(await screen.findByText("No asset classes in scope")).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
  });
  expect(mocks.fetchAssetRoleSummary).not.toHaveBeenCalled();
}

/** A `/ws/alarms` event refetches the role summary. */
export async function socketEventRefetchesTheRoleSummary(): Promise<void> {
  renderItems([TRANSFORMER]);
  await waitFor(() => expect(mocks.fetchAssetRoleSummary).toHaveBeenCalledTimes(1));
  const handler = mocks.handlers.get("alarm");
  expect(handler, "the strip registered no `alarm` handler").toBeTruthy();
  const event = { type: "created" } as unknown as AlarmSocketEvent;
  act(() => {
    handler?.(event);
  });
  await waitFor(() => expect(mocks.fetchAssetRoleSummary).toHaveBeenCalledTimes(2));
}
