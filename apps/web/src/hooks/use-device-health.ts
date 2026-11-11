import { useQuery } from "@tanstack/react-query";

import { fetchDeviceHealth } from "../api/device-health";

/**
 * `F3.16` — the RTUs page's device-health poll period, the footer status's
 * (`SYSTEM_STATUS_REFETCH_MS`): a state is judged against a heartbeat that
 * moves every 10 s, so 30 s keeps the page within one Stale band of the truth.
 */
export const DEVICE_HEALTH_REFETCH_MS = 30_000;

/**
 * `GET /api/v1/admin/device-health?locationId=`, polled every
 * `DEVICE_HEALTH_REFETCH_MS`. The RTU list does not wait on it: a failed read
 * leaves the list rendered with "—" in the health cells.
 */
export function useDeviceHealth(locationId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "device-health", locationId ?? null],
    queryFn: () => fetchDeviceHealth(locationId),
    refetchInterval: DEVICE_HEALTH_REFETCH_MS,
  });
}
