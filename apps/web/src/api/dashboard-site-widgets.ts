import { siteWidgetsResponseSchema } from "@bms/shared/contracts";
import type { SiteWidgetsResponse } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `GET /api/v1/dashboards/:id/site-widgets` — `F3.73` (plan D9): what the five site widgets of
 * one dashboard tab draw. `tabKey` is the widget's own tab (`null` for the Overview and for a
 * legacy canvas, which send no `tab`). Same shape as `fetchDashboardMimicNodes`: the 401 reaches
 * `clearSessionOnAuthFailure` before the body is read, and the `ApiError` keeps its status.
 * `signal` is the query's own, not optional: a cancelled read must abort its request.
 */
export async function fetchSiteWidgets(
  dashboardId: string,
  tabKey: string | null,
  signal: AbortSignal | undefined,
): Promise<SiteWidgetsResponse> {
  const endpoint = "dashboards/:id/site-widgets";
  const query = tabKey === null ? "" : `?tab=${encodeURIComponent(tabKey)}`;
  const sent = withAuth({ signal });
  const res = await fetch(
    `${base}/api/v1/dashboards/${encodeURIComponent(dashboardId)}/site-widgets${query}`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    const text = await res.text();
    throw new ApiError(text || `${endpoint} ${res.status}`, res.status);
  }
  return checkResponse(siteWidgetsResponseSchema, await res.json(), endpoint);
}
