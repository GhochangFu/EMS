import {
  adminAssetGroupDtoSchema,
  adminAssetGroupListResponseSchema,
  adminAssetGroupMemberDtoSchema,
  adminAssetGroupMembersResponseSchema,
} from "@bms/shared/contracts";
import type {
  AddAssetGroupMemberBody,
  AdminAssetGroupDto,
  AdminAssetGroupListResponse,
  AdminAssetGroupMemberDto,
  AdminAssetGroupMembersResponse,
  CreateAssetGroupBody,
  UpdateAssetGroupBody,
} from "@bms/shared";

import { ApiError } from "../../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "../http";
import { adminFetch } from "./client";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin surface.
 *
 * Query keys are exported so the page and any future consumer share them: two
 * keys for one payload would mean two fetches and two chances to render a
 * different member list on the same screen (`vocabularies.ts` records the same
 * reasoning).
 */
/**
 * Keyed on the location filter, not a bare constant.
 *
 * `fetchAdminAssetGroups` takes a `locationId`, so a constant key would serve
 * the *unfiltered* list from cache the moment a filter was applied — the list
 * would look filtered to no one and correct to everyone. Caught in review
 * before any caller passed one.
 */
export const adminAssetGroupsQueryKey = (locationId?: string) =>
  ["admin", "asset-groups", locationId ?? "all"] as const;

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

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** `F3.78` — POST /api/v1/admin/asset-groups. `code` is fixed from here on. */
export async function createAdminAssetGroup(
  body: CreateAssetGroupBody,
): Promise<AdminAssetGroupDto> {
  return adminFetch("/admin/asset-groups", adminAssetGroupDtoSchema, jsonInit("POST", body));
}

/**
 * `F3.78` — PATCH /api/v1/admin/asset-groups/:id.
 *
 * `UpdateAssetGroupBody` has no `code`, and the route is `.strict()`: a
 * dashboard tab and a site template resolve a group by code, so a rename is a
 * different group and the server answers 400 rather than dropping the field.
 */
export async function updateAdminAssetGroup(
  groupId: string,
  body: UpdateAssetGroupBody,
): Promise<AdminAssetGroupDto> {
  return adminFetch(
    `/admin/asset-groups/${groupId}`,
    adminAssetGroupDtoSchema,
    jsonInit("PATCH", body),
  );
}

/** `F3.78` — POST /api/v1/admin/asset-groups/:id/members. */
export async function addAdminAssetGroupMember(
  groupId: string,
  body: AddAssetGroupMemberBody,
): Promise<AdminAssetGroupMemberDto> {
  return adminFetch(
    `/admin/asset-groups/${groupId}/members`,
    adminAssetGroupMemberDtoSchema,
    jsonInit("POST", body),
  );
}

/**
 * `F3.78` — DELETE /api/v1/admin/asset-group-members/:id, 204 and no body.
 *
 * `adminFetch` reads `res.json()`, so this is `deleteAdminCalcParameter`'s
 * shape: success is `status === 204`, a refusal is the same
 * `clearSessionOnAuthFailure` then `ApiError` sequence.
 */
export async function removeAdminAssetGroupMember(membershipId: string): Promise<void> {
  const sent = withAuth({ method: "DELETE" });
  const res = await fetch(
    `${base}/api/v1/admin/asset-group-members/${encodeURIComponent(membershipId)}`,
    sent,
  );
  if (res.status === 204) {
    return;
  }
  clearSessionOnAuthFailure(res, sent);
  const text = await res.text();
  throw new ApiError(text || `admin /admin/asset-group-members/:id ${res.status}`, res.status);
}
