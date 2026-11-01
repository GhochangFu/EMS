import { orgTrendPointsDtoSchema, trendPointSegmentSchema } from "@bms/shared/contracts";
import type { OrgTrendPointsDto, TrendPointSegmentDto } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `F4.300` (ADR 0108 decision 3) — one organization's effective trend points,
 * every active segment with its source (`catalog` or `organization`) and its
 * catalog default list. Refused to every role but an organization-level
 * administrator.
 */
export async function fetchOrgTrendPoints(organizationId: string): Promise<OrgTrendPointsDto> {
  return adminFetch(
    `/admin/organizations/${encodeURIComponent(organizationId)}/trend-points`,
    orgTrendPointsDtoSchema,
  );
}

/**
 * Replaces one segment's list for the organization, in order (plan C3). An
 * empty `pointKeys` removes the override, so the catalog default applies again.
 */
export async function putOrgTrendPointSegment(
  organizationId: string,
  domain: string,
  pointKeys: readonly string[],
): Promise<TrendPointSegmentDto> {
  return adminFetch(
    `/admin/organizations/${encodeURIComponent(organizationId)}/trend-points/${encodeURIComponent(domain)}`,
    trendPointSegmentSchema,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pointKeys }),
    },
  );
}
