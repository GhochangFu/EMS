import {
  locationDashboardDtoSchema,
  locationsSummaryResponseSchema,
} from "@bms/shared/contracts";
import type { LocationDashboardDto, LocationKpiSummary } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** GET /api/v1/dashboard/locations */
export async function fetchLocationKpis(): Promise<{ items: LocationKpiSummary[] }> {
  const res = await fetch(`${base}/api/v1/dashboard/locations`, withAuth());
  if (!res.ok) {
    throw new Error(`location kpis ${res.status}`);
  }
  return checkResponse(locationsSummaryResponseSchema, await res.json(), "dashboard/locations");
}

/** GET /api/v1/dashboard/locations/:locationId */
export async function fetchLocationDashboard(
  locationId: string,
  opts?: { page?: number; pageSize?: number; rtuId?: string },
): Promise<LocationDashboardDto> {
  const params = new URLSearchParams();
  if (opts?.page) {
    params.set("page", String(opts.page));
  }
  if (opts?.pageSize) {
    params.set("pageSize", String(opts.pageSize));
  }
  if (opts?.rtuId) {
    params.set("rtuId", opts.rtuId);
  }
  const queryString = params.toString();
  const qs = queryString ? `?${queryString}` : "";
  const res = await fetch(
    `${base}/api/v1/dashboard/locations/${locationId}${qs}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`location dashboard ${res.status}`);
  }
  return checkResponse(locationDashboardDtoSchema, await res.json(), "dashboard/locations/:id:id");
}
