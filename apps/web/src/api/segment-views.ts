import { siteSegmentViewsSchema } from "@bms/shared/contracts";
import type { SiteSegmentViewsDto, SiteSegmentViewsQuery } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 item 4) — one segment of the site's Trends & Energy section,
 * one read per (site, segment, point, range, compare). The `trend-strip.ts` shape —
 * `withAuth`, `clearSessionOnAuthFailure` on a non-OK status, the body checked against the
 * contract — except that the thrown error is an `ApiError` carrying the status, so the view can
 * tell a segment or point that is not at the site (404) from a failure without reading a message.
 */

/** The search, one key per set field, in the contract's order; an absent field sends no key. */
function segmentSearch(query: SiteSegmentViewsQuery): URLSearchParams {
  const params = new URLSearchParams({ range: query.range });
  for (const key of ["segment", "point", "from", "to", "compare"] as const) {
    const value = query[key];
    if (value !== undefined) {
      params.append(key, value);
    }
  }
  return params;
}

/** The react-query key of one segment read. */
export function segmentViewsQueryKey(locationId: string, query: SiteSegmentViewsQuery): readonly unknown[] {
  return ["control-room", "segment-views", locationId, query];
}

/** GET /api/v1/control-room/sites/:locationId/segment-views */
export async function fetchSiteSegmentViews(
  locationId: string,
  query: SiteSegmentViewsQuery,
): Promise<SiteSegmentViewsDto> {
  const sent = withAuth();
  const res = await fetch(
    `${base}/api/v1/control-room/sites/${encodeURIComponent(locationId)}/segment-views?${segmentSearch(query)}`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`control-room/sites/:id/segment-views ${res.status}`, res.status);
  }
  return checkResponse(siteSegmentViewsSchema, await res.json(), "control-room/sites/:id/segment-views");
}

/** True for the 404 the route answers for a segment or point that is not at the site. */
export function isSegmentNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
