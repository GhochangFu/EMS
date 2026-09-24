import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import * as telemetryApi from "../api/telemetry";
import { usePriorPointValues } from "./use-prior-point-values";

/**
 * `F3.28` task 2.6 — `usePriorPointValues`: disabled with no refs, fetches
 * with refs, and its query key changes when the floored minute changes.
 *
 * `../api/telemetry` is mocked whole so no network call happens; each
 * `it()` reads one behaviour so a mutation to one reddens only that case.
 */

const REF_A = "asset-a::kw";
const REF_B = "asset-b::backup_min";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** With no refs the hook never calls the fetcher, and reports `isPending`
 * without ever resolving into data. */
export async function isDisabledWithZeroRefs(): Promise<void> {
  const spy = vi.spyOn(telemetryApi, "fetchPointValuesAt");
  const { result } = renderHook(() => usePriorPointValues([]), { wrapper });

  expect(spy).not.toHaveBeenCalled();
  expect(result.current.isPending).toBe(true);
  expect(result.current.byRef.size).toBe(0);
}

/** With refs the hook fetches and exposes the values by ref. */
export async function fetchesWithRefsAndExposesByRef(): Promise<void> {
  vi.spyOn(telemetryApi, "fetchPointValuesAt").mockResolvedValue({
    at: "2026-09-23T10:15:00.000Z",
    items: [
      { pointRef: REF_A, time: "2026-09-23T10:15:00.000Z", value: 12.5, unit: "kW" },
      { pointRef: REF_B, time: null, value: null, unit: null },
    ],
  });

  const { result } = renderHook(() => usePriorPointValues([REF_A, REF_B]), { wrapper });

  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current.byRef.get(REF_A)).toBe(12.5);
  expect(result.current.byRef.get(REF_B)).toBeNull();
}

/** The query key includes the floored minute: two calls a minute apart ask
 * the fetcher for two different `at` values. */
export async function queryKeyChangesWhenTheMinuteChanges(): Promise<void> {
  const spy = vi.spyOn(telemetryApi, "fetchPointValuesAt").mockResolvedValue({
    at: "irrelevant",
    items: [],
  });

  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 24, 10, 15, 0, 0));
  const { result, rerender } = renderHook(() => usePriorPointValues([REF_A]), { wrapper });
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  const firstAt = spy.mock.calls[0]?.[1];

  vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 24, 10, 16, 0, 0));
  rerender();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  const secondAt = spy.mock.calls[1]?.[1];

  expect(firstAt).not.toBe(secondAt);
  void result;
}

/**
 * One `QueryClient` for the whole test. `wrapper` above builds a new client on
 * every render, so a re-render there starts from an empty cache — which would
 * hide both claims below: a same-minute re-render would refetch anyway, and a
 * minute roll would have no previous data to keep.
 */
function stableWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function StableWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Lets any fetch a render would start actually start, before an absence is asserted. */
async function flushOneTick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const PRIOR_RESPONSE = {
  at: "2026-09-23T10:15:00.000Z",
  items: [{ pointRef: REF_A, time: "2026-09-23T10:15:00.000Z", value: 12.5, unit: "kW" }],
};

/**
 * Two re-renders inside one minute (10:15:00 → 10:15:45) ask the fetcher once:
 * the minute floor holds the key still. An un-floored `at` would move the key
 * on every render and fetch each time.
 */
export async function reRendersInsideOneMinuteFetchOnce(): Promise<void> {
  const spy = vi.spyOn(telemetryApi, "fetchPointValuesAt").mockResolvedValue(PRIOR_RESPONSE);
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 24, 10, 15, 0, 0));
  const { result, rerender } = renderHook(() => usePriorPointValues([REF_A]), {
    wrapper: stableWrapper(),
  });
  await waitFor(() => expect(result.current.byRef.get(REF_A)).toBe(12.5));
  expect(spy).toHaveBeenCalledTimes(1);

  now.mockReturnValue(Date.UTC(2026, 8, 24, 10, 15, 20, 0));
  rerender();
  await flushOneTick();
  now.mockReturnValue(Date.UTC(2026, 8, 24, 10, 15, 45, 0));
  rerender();
  await flushOneTick();

  expect(spy).toHaveBeenCalledTimes(1);
}

/**
 * Across a minute roll the previous minute's value stays visible while the new
 * key fetches. The second fetch never resolves, so what the hook reports is
 * what it shows for the length of that fetch. The two distinct `at` arguments
 * are the positive control that the key did roll.
 */
export async function previousValuesStayVisibleWhileTheNextMinuteFetches(): Promise<void> {
  const spy = vi
    .spyOn(telemetryApi, "fetchPointValuesAt")
    .mockResolvedValueOnce(PRIOR_RESPONSE)
    .mockImplementationOnce(() => new Promise(() => undefined));
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 24, 10, 15, 0, 0));
  const { result, rerender } = renderHook(() => usePriorPointValues([REF_A]), {
    wrapper: stableWrapper(),
  });
  await waitFor(() => expect(result.current.byRef.get(REF_A)).toBe(12.5));

  now.mockReturnValue(Date.UTC(2026, 8, 24, 10, 16, 0, 0));
  rerender();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  expect(spy.mock.calls[0]?.[1]).not.toBe(spy.mock.calls[1]?.[1]);

  expect(result.current.byRef.get(REF_A)).toBe(12.5);
}
