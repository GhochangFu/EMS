import type { DashboardKpis, LoadTrendPoint } from "@bms/shared";

import { withAuth } from "./http";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchDashboardKpis(): Promise<DashboardKpis> {
  const res = await fetch(`${base}/api/v1/dashboard/kpis`, withAuth());
  if (!res.ok) {
    throw new Error(`dashboard kpis ${res.status}`);
  }
  return res.json() as Promise<DashboardKpis>;
}

export async function fetchLoadTrend(
  window = "60m",
): Promise<{ points: LoadTrendPoint[] }> {
  const res = await fetch(
    `${base}/api/v1/dashboard/load-trend?window=${encodeURIComponent(window)}`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`load-trend ${res.status}`);
  }
  return res.json() as Promise<{ points: LoadTrendPoint[] }>;
}
