import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
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
