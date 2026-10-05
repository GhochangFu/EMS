import { dashboardMimicNodesResponseSchema } from "@bms/shared/contracts";
import type { DashboardMimicNodesResponseDto } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `GET /api/v1/dashboards/:id/mimic-nodes` — `F3.32` (ADR 0079, plan D1): every `mimic` widget
 * on one dashboard with its nodes resolved. Not in `api/dashboards.ts`, which is `F3.1d`'s; the
 * shape is that file's `dashboardsFetch` — the 401 reaches `clearSessionOnAuthFailure` before the
 * body is read, and the thrown `ApiError` keeps the status `lib/query-retry.ts` reads (`F4.63`).
 */
export async function fetchDashboardMimicNodes(dashboardId: string): Promise<DashboardMimicNodesResponseDto> {
  const endpoint = "dashboards/:id/mimic-nodes";
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/dashboards/${encodeURIComponent(dashboardId)}/mimic-nodes`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new ApiError(text || `${endpoint} ${res.status}`, res.status);
  }
  return checkResponse(dashboardMimicNodesResponseSchema, await res.json(), endpoint);
}
