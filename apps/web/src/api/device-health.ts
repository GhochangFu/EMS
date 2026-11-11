import type { DeviceHealthResponse, RtuDropHistoryResponse } from "@bms/shared";
import { deviceHealthResponseSchema, rtuDropHistoryResponseSchema } from "@bms/shared/contracts";

import { adminFetch } from "./admin/client";

/**
 * `F3.16` / ADR 0127 decisions 4, 14 and 17 — per-RTU device health for the
 * admin RTUs page, inside the caller's writable locations; `unattributed` is
 * filled for the global admin only. Checked against the shared contract
 * (ADR 0030) by `adminFetch`.
 */
export async function fetchDeviceHealth(locationId?: string): Promise<DeviceHealthResponse> {
  const query = locationId ? `?${new URLSearchParams({ locationId })}` : "";
  return adminFetch(`/admin/device-health${query}`, deviceHealthResponseSchema);
}

/** One RTU's 30 days of hourly drop buckets. 404 for an RTU outside the caller's scope. */
export async function fetchRtuDropHistory(rtuId: string): Promise<RtuDropHistoryResponse> {
  return adminFetch(`/admin/device-health/rtus/${encodeURIComponent(rtuId)}/drops`, rtuDropHistoryResponseSchema);
}
