import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { MaintenanceWindowItem } from "@bms/shared/contracts";

import * as maintenanceApi from "../api/maintenance-windows";
import { useActiveMaintenance } from "./use-active-maintenance";

/**
 * `F4.359` U11 (plan D16) — `useActiveMaintenance`: the active windows of a page scope, and the union of the
 * asset ids they cover. The request carries `state=active` and the scope (read at the wire in
 * `maintenance-windows.spec.ts`; here at the call the hook makes).
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function window(id: string, assetIds: string[]): MaintenanceWindowItem {
  return {
    id,
    organizationId: ORG,
    reason: "Planned service",
    startsAt: "2026-11-13T08:00:00.000Z",
    endsAt: "2026-11-13T12:00:00.000Z",
    endedAt: null,
    state: "active",
    createdByName: "Admin",
    endedByName: null,
    workOrder: null,
    maintenanceSchedule: null,
    targets: [],
    assetIds,
  };
}

function wrapper(): (props: { children: ReactNode }) => JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Two windows' asset ids union into one set; a shared asset appears once. */
export async function twoWindowsUnionIntoTheSet(): Promise<void> {
  const spy = vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({
    items: [
      window("11111111-1111-4111-8111-111111111111", [A, B]),
      window("22222222-2222-4222-8222-222222222222", [B, C]),
    ],
  });
  const { result } = renderHook(() => useActiveMaintenance({ organizationId: ORG }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.windows).toHaveLength(2));
  expect([...result.current.coveredAssetIds].sort()).toEqual([A, B, C]);
  spy.mockRestore();
}

/** No active window: an empty set, not undefined. */
export async function anEmptyListGivesAnEmptySet(): Promise<void> {
  const spy = vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({ items: [] });
  const { result } = renderHook(() => useActiveMaintenance({ organizationId: ORG }), { wrapper: wrapper() });
  expect(result.current.coveredAssetIds.size).toBe(0);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(result.current.windows).toEqual([]);
  expect(result.current.coveredAssetIds.size).toBe(0);
  spy.mockRestore();
}

/** The request asks for `state=active` and carries the scope. */
export async function theRequestCarriesStateAndScope(): Promise<void> {
  const spy = vi.spyOn(maintenanceApi, "fetchMaintenanceWindows").mockResolvedValue({ items: [] });
  renderHook(() => useActiveMaintenance({ assetId: A }), { wrapper: wrapper() });
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]?.[0]).toEqual({ state: "active", assetId: A });
  spy.mockRestore();
}
