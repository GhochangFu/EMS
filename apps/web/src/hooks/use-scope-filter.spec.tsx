import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { expect, vi } from "vitest";

import * as filterOptionsApi from "../api/filter-options";
import { IDS, OPTIONS } from "../lib/scope-filter.spec";
import { useScopeFilter } from "./use-scope-filter";

/**
 * `F4.361` U6 (ADR 0132 decision 8; plan D12, D13) — the scope filter lives in the URL. The hook
 * runs in a `MemoryRouter`, so the URL, the navigation type (push or replace) and Back are the
 * observable places. `use-scope-filter.test.tsx` is the Vitest entry point. The options read is a
 * spy: an unstubbed read would reach the API on :4000.
 */

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => ({ scope: useScopeFilter(), location: useLocation(), navigate: useNavigate(), type: useNavigationType() }),
    { wrapper },
  );
  return Object.assign(hook, { qc });
}

/** The URL's ids are the filter once the options confirm them, and the list may run. */
export async function theUrlIsTheFilter(): Promise<void> {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockResolvedValue(OPTIONS);
  const { result } = mount(`/alarms?organizationId=${IDS.ORG_A}&locationId=${IDS.SITE_A}`);
  await waitFor(() => expect(result.current.scope.options).toBe(OPTIONS));
  expect(result.current.scope.filter).toEqual({ organizationId: IDS.ORG_A, locationId: IDS.SITE_A });
  expect(result.current.scope.ready).toBe(true);
  expect(result.current.scope.unavailable).toBe(false);
}

/** An id the options do not list is removed from the URL by a replace, other parameters kept (D12). */
export async function anUnknownIdIsRemovedFromTheUrl(): Promise<void> {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockResolvedValue(OPTIONS);
  const { result } = mount(`/alarms?organizationId=${IDS.UNKNOWN}&severity=critical`);
  await waitFor(() => expect(result.current.location.search).toBe("?severity=critical"));
  expect(result.current.type).toBe("REPLACE");
  expect(result.current.scope.filter).toEqual({});
}

/** A user's change pushes a history entry, and Back restores the URL before it (D12, decision 8). */
export async function aChangeIsUndoneByBack(): Promise<void> {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockResolvedValue(OPTIONS);
  const { result } = mount("/alarms?severity=critical");
  await waitFor(() => expect(result.current.scope.options).toBe(OPTIONS));
  act(() => result.current.scope.setScope("organizationId", IDS.ORG_A));
  await waitFor(() => expect(result.current.scope.filter).toEqual({ organizationId: IDS.ORG_A }));
  expect(result.current.type).toBe("PUSH");
  expect(new URLSearchParams(result.current.location.search).get("organizationId")).toBe(IDS.ORG_A);
  expect(new URLSearchParams(result.current.location.search).get("severity")).toBe("critical");
  act(() => result.current.navigate(-1));
  await waitFor(() => expect(result.current.location.search).toBe("?severity=critical"));
  expect(result.current.scope.filter).toEqual({});
}

/** A failed options read leaves the URL as it is, runs the list on it and reports the pickers unavailable (D13). */
export async function anOptionsErrorLeavesTheUrl(): Promise<void> {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockRejectedValue(new Error("filter-options 500"));
  const { result } = mount(`/alarms?organizationId=${IDS.UNKNOWN}`);
  await waitFor(() => expect(result.current.scope.unavailable).toBe(true));
  expect(result.current.location.search).toBe(`?organizationId=${IDS.UNKNOWN}`);
  expect(result.current.scope.filter).toEqual({ organizationId: IDS.UNKNOWN });
  expect(result.current.scope.ready).toBe(true);
}

/** The list waits for the options only when the URL names a scope (D13). */
export async function theListWaitsOnlyForAScopedUrl(): Promise<void> {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockReturnValue(new Promise(() => undefined));
  const scoped = mount(`/alarms?locationId=${IDS.SITE_A}`);
  expect(scoped.result.current.scope.ready).toBe(false);
  const plain = mount("/alarms?severity=critical");
  expect(plain.result.current.scope.ready).toBe(true);
  expect(plain.result.current.scope.filter).toEqual({});
}

/**
 * A failed background refetch keeps the options already read, so the pickers keep working and the
 * "unavailable" line stays away; only a read with no data at all is unavailable.
 */
export async function aFailedRefetchKeepsThePickersAvailable(): Promise<void> {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions")
    .mockResolvedValueOnce(OPTIONS)
    .mockRejectedValue(new Error("filter-options 500"));
  const { result, qc } = mount(`/alarms?organizationId=${IDS.ORG_A}`);
  await waitFor(() => expect(result.current.scope.options).toBe(OPTIONS));
  await act(() => qc.refetchQueries({ queryKey: filterOptionsApi.filterOptionsQueryKey }));
  await waitFor(() => expect(qc.getQueryState(filterOptionsApi.filterOptionsQueryKey)?.status).toBe("error"));
  expect(result.current.scope.options).toBe(OPTIONS);
  expect(result.current.scope.unavailable).toBe(false);
  expect(result.current.scope.filter).toEqual({ organizationId: IDS.ORG_A });
}
