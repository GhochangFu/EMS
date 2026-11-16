import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { AssetAnomaliesResponse } from "@bms/shared";

import * as mlApi from "../api/ml";
import { FORECAST_REFETCH_MS } from "../lib/forecast-series";
import { useAssetAnomalies } from "./use-asset-anomalies";

/**
 * `E1.2b` — `useAssetAnomalies`: one read per asset and window, the window in whole hours, the
 * 15-minute re-poll that stops after a 403, nothing when disabled, and a failed read — first or
 * later — is simply no marks. Every failure here is a 403, final under `retryUnlessForbidden`.
 * Entry point: `use-asset-anomalies.test.tsx` (ADR 0014).
 */
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WINDOW = { from: "2026-11-15T10:20:00.000Z", to: "2026-11-16T10:20:00.000Z" };
const ANSWER: AssetAnomaliesResponse = {
  asOf: "2026-11-16T10:20:00.000Z",
  scores: [{ t: "2026-11-16T09:00:00.000Z", detector: "baseline_mad", score: 0.995, contributingPoints: ["kw"] }],
};
const FORBIDDEN = new Error("ml asset anomalies 403");

function harness(): { client: QueryClient; wrapper: (props: { children: ReactNode }) => JSX.Element } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

/** One read, over the window in whole hours, whose query re-polls every 15 minutes until a 403. */
export async function oneReadOverTheWholeHourWindow(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchAssetAnomalies").mockResolvedValue(ANSWER);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetAnomalies(ASSET, WINDOW, true), { wrapper });
  await waitFor(() => expect(result.current).toEqual(ANSWER.scores));
  expect(spy.mock.calls).toEqual([[ASSET, "2026-11-15T10:00:00.000Z", "2026-11-16T11:00:00.000Z"]]);
  const queries = client.getQueryCache().findAll({ queryKey: ["asset-anomalies"] });
  expect(queries).toHaveLength(1);
  const interval = (queries[0]?.options as { readonly refetchInterval?: unknown }).refetchInterval;
  expect(typeof interval).toBe("function");
  const call = interval as (q: { state: { error: unknown } }) => number | false;
  expect(call({ state: { error: null } })).toBe(FORECAST_REFETCH_MS);
  expect(call({ state: { error: FORBIDDEN } })).toBe(false);
  const focus = (queries[0]?.options as { readonly refetchOnWindowFocus?: unknown }).refetchOnWindowFocus as (q: {
    state: { error: unknown };
  }) => boolean;
  expect(focus({ state: { error: FORBIDDEN } })).toBe(false);
  expect(focus({ state: { error: null } })).toBe(true);
  spy.mockRestore();
}

/** Disabled, or before the window is known, asks nothing and draws nothing. */
export async function disabledOrNoWindowAsksNothing(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchAssetAnomalies").mockResolvedValue(ANSWER);
  const off = renderHook(() => useAssetAnomalies(ASSET, WINDOW, false), { wrapper: harness().wrapper });
  const noWindow = renderHook(() => useAssetAnomalies(ASSET, null, true), { wrapper: harness().wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
  expect(off.result.current).toBeUndefined();
  expect(noWindow.result.current).toBeUndefined();
  spy.mockRestore();
}

/** Turning the gate off (avg → max) hides cached marks at once. */
export async function cachedMarksAreHiddenOnceDisabled(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchAssetAnomalies").mockResolvedValue(ANSWER);
  const { result, rerender } = renderHook(({ on }: { on: boolean }) => useAssetAnomalies(ASSET, WINDOW, on), {
    wrapper: harness().wrapper,
    initialProps: { on: true },
  });
  await waitFor(() => expect(result.current).toEqual(ANSWER.scores));
  rerender({ on: false });
  expect(result.current).toBeUndefined();
  spy.mockRestore();
}

/** A failed first read, settled, is no marks — and it is asked once (a 403 is final). */
export async function aFailedReadIsNoMarks(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchAssetAnomalies").mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetAnomalies(ASSET, WINDOW, true), { wrapper });
  await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ["asset-anomalies"] })[0]?.state.status).toBe("error"));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(result.current).toBeUndefined();
  spy.mockRestore();
}

/** A later refetch that fails drops the last marks rather than drawing them on. */
export async function aFailedRefetchDropsTheMarks(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchAssetAnomalies").mockResolvedValueOnce(ANSWER).mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetAnomalies(ASSET, WINDOW, true), { wrapper });
  await waitFor(() => expect(result.current).toEqual(ANSWER.scores));
  await client.refetchQueries({ queryKey: ["asset-anomalies"] });
  await waitFor(() => expect(result.current).toBeUndefined());
  spy.mockRestore();
}
