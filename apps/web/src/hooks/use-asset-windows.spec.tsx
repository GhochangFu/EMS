import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import * as telemetryApi from "../api/telemetry";
import { useAssetWindows } from "./use-asset-windows";

/**
 * `F4.350` (ADR 0075 Amendment 3) — `useAssetWindows`: the API's seconds arrive as milliseconds, an asset
 * the read did not answer is absent (so the caller falls back to the floor), and an empty list asks nothing.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function wrapper(): (props: { children: ReactNode }) => JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The seconds become ms; the answered asset is present, an unanswered one is absent. */
export async function windowsArriveInMilliseconds(): Promise<void> {
  const spy = vi
    .spyOn(telemetryApi, "fetchAssetWindows")
    .mockResolvedValue({ items: [{ assetId: A, freshnessWindowSeconds: 150 }] });
  const { result } = renderHook(() => useAssetWindows([B, A, A]), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.get(A)).toBe(150_000));
  expect(result.current.has(B)).toBe(false);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]?.[0]).toEqual([A, B]);
  spy.mockRestore();
}

/** No asset to ask about: no request. */
export async function anEmptyListAsksNothing(): Promise<void> {
  const spy = vi.spyOn(telemetryApi, "fetchAssetWindows");
  const { result } = renderHook(() => useAssetWindows([]), { wrapper: wrapper() });
  expect(result.current.size).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
}

/** A failed read leaves the map empty — every asset keeps the floor. */
export async function aFailedReadKeepsTheFloor(): Promise<void> {
  const spy = vi.spyOn(telemetryApi, "fetchAssetWindows").mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => useAssetWindows([A]), { wrapper: wrapper() });
  await waitFor(() => expect(spy).toHaveBeenCalled());
  // Let the rejection land in the query before asserting, so an empty map is the answer to a failure and not just "not yet".
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(result.current.size).toBe(0);
  spy.mockRestore();
}
