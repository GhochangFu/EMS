import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { MaintenanceWindowItem } from "@bms/shared/contracts";

import { fetchMaintenanceWindows } from "../api/maintenance-windows";

/**
 * What a page reads about: one asset, one location (and its subtree), one organization, or — `{}`, the
 * alarm bar off a scoped page (`F4.359` U13) — every window the caller can read.
 */
export type MaintenanceScope =
  | { readonly assetId: string }
  | { readonly locationId: string }
  | { readonly organizationId: string }
  | Readonly<Record<string, never>>;

const EMPTY_WINDOWS: readonly MaintenanceWindowItem[] = [];

/** A window's state moves with the clock, not an event, so the read polls once a minute. */
export const ACTIVE_MAINTENANCE_REFETCH_MS = 60_000;

/**
 * `F4.359` U11 (plan D16/D17) — the active maintenance windows in `scope`, and the union of the asset ids
 * they cover. The API narrows to the caller's readable assets, so `assetIds` is already caller-readable.
 */
export function useActiveMaintenance(scope: MaintenanceScope): {
  readonly windows: readonly MaintenanceWindowItem[];
  readonly coveredAssetIds: ReadonlySet<string>;
} {
  const q = useQuery({
    queryKey: ["maintenance-windows", "active", scope],
    queryFn: () => fetchMaintenanceWindows({ state: "active", ...scope }),
    refetchInterval: ACTIVE_MAINTENANCE_REFETCH_MS,
  });
  const windows = q.data?.items ?? EMPTY_WINDOWS;
  const coveredAssetIds = useMemo(() => new Set(windows.flatMap((w) => w.assetIds)), [windows]);
  return { windows, coveredAssetIds };
}
