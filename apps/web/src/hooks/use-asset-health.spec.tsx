import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { HealthSummaryResponse } from "@bms/shared";

import * as assetHealthApi from "../api/asset-health";
import { useHealthSummary } from "./use-asset-health";

/**
 * `F3.72` U1 — `useHealthSummary(filter)`: the filter reaches the fetcher, and the query key
 * carries both fields, so two scopes are two cache entries.
 *
 * **One `QueryClient` for both renders.** A wrapper that builds its client inside would give
 * each render a fresh cache, and a key that dropped `organizationId` would still refetch — the
 * case would stay green with the defect in. The client is shared, so only a key that differs
 * makes the second fetch.
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "44444444-4444-4444-8444-444444444444";
const LOCATION = "33333333-3333-4333-8333-333333333333";

const SUMMARY = { assetCount: 0 } as unknown as HealthSummaryResponse;

function sharedWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The filter object is handed to the fetcher whole. */
export async function theFilterReachesTheFetcher(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  renderHook(() => useHealthSummary({ organizationId: ORG_A, locationId: LOCATION }), {
    wrapper: sharedWrapper(),
  });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]).toEqual([{ organizationId: ORG_A, locationId: LOCATION }]);
}

/** Two organizations on one client are two fetches — the key carries `organizationId`. */
export async function theKeyCarriesTheOrganizationId(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  const { rerender } = renderHook(
    ({ organizationId }: { organizationId: string }) => useHealthSummary({ organizationId }),
    { wrapper: sharedWrapper(), initialProps: { organizationId: ORG_A } },
  );
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

  rerender({ organizationId: ORG_B });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  expect(spy.mock.calls.map(([filter]) => filter?.organizationId)).toEqual([ORG_A, ORG_B]);
}

/** Two locations on one client are two fetches — the key carries `locationId` too. */
export async function theKeyCarriesTheLocationId(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  const { rerender } = renderHook(
    ({ locationId }: { locationId?: string }) => useHealthSummary({ locationId }),
    { wrapper: sharedWrapper(), initialProps: { locationId: undefined as string | undefined } },
  );
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

  rerender({ locationId: LOCATION });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  expect(spy.mock.calls.map(([filter]) => filter?.locationId)).toEqual([undefined, LOCATION]);
}

/** No argument is the enterprise summary: the fetcher receives an empty filter. */
export async function noArgumentIsTheEnterpriseSummary(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  renderHook(() => useHealthSummary(), { wrapper: sharedWrapper() });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]).toEqual([{}]);
}
