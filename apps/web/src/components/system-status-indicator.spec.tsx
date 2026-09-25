import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { SystemStatusResponse } from "@bms/shared";

import * as systemStatusApi from "../api/system-status";
import { stubAbortSignalTimeout } from "../api/system-status.spec";
import { SYSTEM_STATUS_REFETCH_MS } from "../hooks/use-system-status";
import { titleLine } from "../lib/system-status-bands";
import { SystemStatusIndicator } from "./system-status-indicator";

/**
 * `F3.30` Unit 9 — the footer's System Status and Data Quality indicator
 * (ADR 0075 decision 5; plan decisions 3–5).
 *
 * Assertions live here; `system-status-indicator.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * Every case waits on a string the **data** produces (the verdict, the band
 * word, "Status unavailable"), never on the wrapping `<span>` or the dot,
 * which render in the loading state before the query settles.
 */

export const OPERATIONAL: SystemStatusResponse = {
  status: "operational",
  components: [
    { key: "queue", state: "ok" },
    { key: "storage", state: "not_configured" },
    { key: "field_data", state: "ok" },
  ],
  dataQuality: { percent: 98.6, freshAssets: 148, streamingAssets: 150, windowSeconds: 25 },
  checkedAt: "2026-09-25T00:00:00.000Z",
};

export const FIELD_DATA_DEGRADED: SystemStatusResponse = {
  ...OPERATIONAL,
  status: "degraded",
  components: [
    { key: "queue", state: "ok" },
    { key: "storage", state: "not_configured" },
    { key: "field_data", state: "degraded" },
  ],
};

function withPercent(percent: number | null): SystemStatusResponse {
  return { ...OPERATIONAL, dataQuality: { ...OPERATIONAL.dataQuality, percent } };
}

/**
 * `retry: false` here is inert since the hook sets its own `retry: 1` (a query
 * option beats `defaultOptions`); `retryDelay: 0` is what keeps the error
 * cases inside `findByText`'s 1 s wait — the hook sets no delay of its own.
 */
function renderIndicator(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SystemStatusIndicator />
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The element carrying the `title`, reached from a string the data produced. */
async function indicatorFor(text: string): Promise<HTMLElement> {
  const wrapper = (await screen.findByText(text)).closest("[title]");
  expect(wrapper, `no [title] element holds ${JSON.stringify(text)}`).toBeTruthy();
  return wrapper as HTMLElement;
}

/** Case 1 — an operational body renders the operational verdict. */
export async function anOperationalBodyRendersTheOperationalVerdict(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  renderIndicator();
  expect(await screen.findByText("All systems operational")).toBeInTheDocument();
}

/** Case 2 — a degraded `field_data` names its label in the verdict. */
export async function aDegradedFieldDataRendersItsLabel(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(FIELD_DATA_DEGRADED);
  renderIndicator();
  expect(await screen.findByText("Degraded: Field data")).toBeInTheDocument();
}

/**
 * Case 3a — 98.6 % renders the full owner-confirmed line, band included. This
 * is also the positive control for case 5b's `%` absence check.
 */
export async function ninetyEightPointSixRendersGood(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(withPercent(98.6));
  renderIndicator();
  const wrapper = await indicatorFor("Good");
  expect(wrapper.textContent).toContain("Data quality 98.6 % Good");
}

/** Case 3b — 85 % bands as Fair. */
export async function eightyFiveRendersFair(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(withPercent(85));
  renderIndicator();
  expect(await screen.findByText("Fair")).toBeInTheDocument();
}

/** Case 3c — 50 % bands as Poor. */
export async function fiftyRendersPoor(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(withPercent(50));
  renderIndicator();
  expect(await screen.findByText("Poor")).toBeInTheDocument();
}

/**
 * Case 4 — `percent: null` renders "Data quality —" and no band word. The
 * wrapper is reached through the verdict, so the absence check runs against a
 * settled render (the verdict is the adjacent positive control).
 */
export async function aNullPercentRendersADashAndNoBand(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(withPercent(null));
  renderIndicator();
  const wrapper = await indicatorFor("All systems operational");
  expect(wrapper.textContent).toContain("Data quality —");
  expect(wrapper.textContent).not.toMatch(/Good|Fair|Poor/);
}

/** Case 5a — a rejected read renders "Status unavailable" in red. */
export async function aRejectedReadRendersStatusUnavailableInRed(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("system/status 503"));
  renderIndicator();
  expect(await screen.findByText("Status unavailable")).toHaveClass("text-red-400");
}

/** Case 5b — a rejected read hides the percentage. */
export async function aRejectedReadHidesThePercentage(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("system/status 503"));
  renderIndicator();
  await screen.findByText("Status unavailable");
  expect(screen.queryByText(/%/)).toBeNull();
}

/**
 * Case 5c — a failed poll after a good one never leaves the stale
 * "operational" on screen (ADR 0075 decisions 3 and 5): TanStack Query keeps
 * the last `data` beside the error, so the component must read the error first.
 */
export async function aFailedRefetchReplacesAStaleOperational(): Promise<void> {
  const spy = vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  const queryClient = renderIndicator();
  await screen.findByText("All systems operational");
  spy.mockRejectedValue(new Error("system/status 503"));
  await queryClient.refetchQueries({ queryKey: ["system", "status"] });
  await screen.findByText("Status unavailable");
  expect(screen.queryByText("All systems operational")).toBeNull();
}

/** Case 6 — the `title` lists every component and its state. */
export async function theTitleListsEveryComponent(): Promise<void> {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(FIELD_DATA_DEGRADED);
  renderIndicator();
  const wrapper = await indicatorFor("Degraded: Field data");
  expect(wrapper.getAttribute("title")).toBe(titleLine(FIELD_DATA_DEGRADED));
}

/** Case 7 — "Checking status…" renders while the read is still open. */
export async function checkingStatusRendersWhileTheReadIsOpen(): Promise<void> {
  let resolve: (body: SystemStatusResponse) => void = () => {};
  const pending = new Promise<SystemStatusResponse>((r) => {
    resolve = r;
  });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockReturnValue(pending);
  renderIndicator();
  expect(screen.getByText("Checking status…")).toBeInTheDocument();
  resolve(OPERATIONAL);
  await screen.findByText("All systems operational");
}

/** Advances fake time inside `act`, so React commits what the query settled. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Case 8 — the hook polls: one read on mount, a second at
 * `SYSTEM_STATUS_REFETCH_MS` (30 s) and not before. The spy is this case's
 * own, so its count is not a lifetime counter (§4.6). Call after
 * `vi.useFakeTimers()`.
 */
export async function theHookPollsEveryThirtySeconds(): Promise<void> {
  const spy = vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  renderIndicator();
  await advance(0);
  expect(screen.getByText("All systems operational")).toBeInTheDocument();
  await advance(SYSTEM_STATUS_REFETCH_MS - 1);
  expect(spy, "control: one read before the poll period").toHaveBeenCalledTimes(1);
  await advance(1);
  expect(spy).toHaveBeenCalledTimes(2);
}

/**
 * The hang scene for cases 9 and 10: the real hook over the real client, a
 * `fetch` that answers the first read and never answers another — it rejects
 * only when its signal aborts, as a real `fetch` does. The client has **no**
 * retry overrides, so the hook's own `retry: 1` and TanStack's default
 * 1 000 ms first retry delay are what run. Returns the per-case call count.
 * Call after `vi.useFakeTimers()`.
 */
async function hangAfterFirstRead(): Promise<() => number> {
  stubAbortSignalTimeout();
  let calls = 0;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve({ ok: true, status: 200, json: async () => OPERATIONAL } as Response);
    }
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  });
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <SystemStatusIndicator />
    </QueryClientProvider>,
  );
  await advance(0);
  expect(screen.getByText("All systems operational")).toBeInTheDocument();
  // The poll starts the hanging read; then its 10 s timeout, the 1 s retry
  // delay, and the retry's own 10 s timeout.
  await advance(SYSTEM_STATUS_REFETCH_MS);
  await advance(10_000);
  await advance(1_000);
  await advance(10_000);
  // One more millisecond: the settled error reaches the component on a timer
  // queued after the abort. Measured 2026-09-25 — without it the last render
  // has not run, with it the case passes; it is not part of the budget.
  await advance(1);
  return () => calls;
}

/**
 * Case 9 — after a good read, a poll the API never answers ends in
 * "Status unavailable" once the 10 s timeout and the one retry have run —
 * not a stale "operational" for as long as the API hangs (code review,
 * Correctness 1).
 */
export async function aHungPollEndsInStatusUnavailable(): Promise<void> {
  await hangAfterFirstRead();
  expect(screen.getByText("Status unavailable")).toBeInTheDocument();
}

/** Case 10 — the hung poll is retried exactly once: the mount read, the poll, one retry. */
export async function aHungPollIsRetriedOnce(): Promise<void> {
  const calls = await hangAfterFirstRead();
  expect(calls()).toBe(3);
}
