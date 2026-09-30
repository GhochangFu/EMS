import {
  dashboardKpisSchema,
  loadTrendResponseSchema,
} from "@bms/shared/contracts";
import type { DashboardKpis, LoadTrendPoint } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchDashboardKpis(): Promise<DashboardKpis> {
  const res = await fetch(`${base}/api/v1/dashboard/kpis`, withAuth());
  if (!res.ok) {
    throw new Error(`dashboard kpis ${res.status}`);
  }
  return checkResponse(dashboardKpisSchema, await res.json(), "dashboard/kpis");
}

/**
 * `GET /dashboard/load-trend`. `organizationId` (`F3.72`, plan D3/D8, OQ1) narrows the trend to
 * that organization's readable assets; without it the read covers the whole readable set.
 */
export async function fetchLoadTrend(
  window = "60m",
  organizationId?: string,
): Promise<{ points: LoadTrendPoint[] }> {
  const organization = organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : "";
  const res = await fetch(
    `${base}/api/v1/dashboard/load-trend?window=${encodeURIComponent(window)}${organization}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`load-trend ${res.status}`);
  }
  return checkResponse(loadTrendResponseSchema, await res.json(), "dashboard/load-trend");
}
