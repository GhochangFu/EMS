import type { LocationDashboardDto, LocationKpiSummary } from "@bms/shared";

import { withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** GET /api/v1/dashboard/locations */
export async function fetchLocationKpis(): Promise<{ items: LocationKpiSummary[] }> {
  const res = await fetch(`${base}/api/v1/dashboard/locations`, withAuth());
  if (!res.ok) {
    throw new Error(`location kpis ${res.status}`);
  }
  return res.json() as Promise<{ items: LocationKpiSummary[] }>;
}

/** GET /api/v1/dashboard/locations/:locationId */
export async function fetchLocationDashboard(
  locationId: string,
): Promise<LocationDashboardDto> {
  const res = await fetch(
    `${base}/api/v1/dashboard/locations/${locationId}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`location dashboard ${res.status}`);
  }
  return res.json() as Promise<LocationDashboardDto>;
}
