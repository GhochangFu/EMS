import {
  adminAssetGroupListResponseSchema,
  adminAssetGroupMemberDtoSchema,
  adminAssetGroupMembersResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminAssetGroupListResponse,
  AdminAssetGroupMemberDto,
  AdminAssetGroupMembersResponse,
} from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin surface.
 *
 * Query keys are exported so the page and any future consumer share them: two
 * keys for one payload would mean two fetches and two chances to render a
 * different member list on the same screen (`vocabularies.ts` records the same
 * reasoning).
 */
export const adminAssetGroupsQueryKey = ["admin", "asset-groups"] as const;

export const adminAssetGroupMembersQueryKey = (groupId: string) =>
  ["admin", "asset-groups", groupId, "members"] as const;

/** GET /api/v1/admin/asset-groups */
export async function fetchAdminAssetGroups(
  locationId?: string,
): Promise<AdminAssetGroupListResponse> {
  const params = new URLSearchParams();
  if (locationId) {
    params.set("locationId", locationId);
  }
  const query = params.toString();
  return adminFetch(
    `/admin/asset-groups${query ? `?${query}` : ""}`,
    adminAssetGroupListResponseSchema,
  );
}

/** GET /api/v1/admin/asset-groups/:id/members — ordered by `assets.code` server-side. */
export async function fetchAdminAssetGroupMembers(
  groupId: string,
): Promise<AdminAssetGroupMembersResponse> {
  return adminFetch(
    `/admin/asset-groups/${groupId}/members`,
    adminAssetGroupMembersResponseSchema,
  );
}

/**
 * PATCH /api/v1/admin/asset-group-members/:id — set or clear one role.
 *
 * `null` clears it. The order is never re-sorted here: the server orders by
 * `assets.code` and that is the contract a section template resolves through.
 */
export async function setAdminAssetGroupMemberRole(
  membershipId: string,
  role: string | null,
): Promise<AdminAssetGroupMemberDto> {
  return adminFetch(
    `/admin/asset-group-members/${membershipId}`,
    adminAssetGroupMemberDtoSchema,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
}
