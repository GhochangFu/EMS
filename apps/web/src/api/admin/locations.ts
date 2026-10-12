import {
  adminLocationDtoSchema,
  adminLocationSummaryDtoSchema,
  locationsListResponseSchema,
  locationTypesListResponseSchema,
  siteControlRoomViewSettingDtoSchema,
} from "@bms/shared/contracts";
import type {
  AdminLocationDto,
  AdminLocationSummaryDto,
  CreateLocationBody,
  LocationsListResponse,
  LocationTypesListResponse,
  MasterDataActiveFilter,
  PutSiteControlRoomViewBody,
  SiteControlRoomViewSettingDto,
  UpdateLocationBody,
} from "@bms/shared";

import { adminFetch } from "./client";

export type { LocationsListResponse };

/** `GET /admin/location-types` (`F4.157`, D9) — the active vocabulary rows for the Type select. */
export async function fetchAdminLocationTypes(): Promise<LocationTypesListResponse> {
  return adminFetch("/admin/location-types", locationTypesListResponseSchema);
}


export async function fetchAdminLocations(
  active: MasterDataActiveFilter = "all",
  organizationId?: string,
): Promise<LocationsListResponse> {
  const params = new URLSearchParams({ active });
  if (organizationId) {
    params.set("organizationId", organizationId);
  }
  return adminFetch(`/admin/locations?${params}`, locationsListResponseSchema);
}

export async function fetchAdminLocationSummary(
  id: string,
): Promise<AdminLocationSummaryDto> {
  return adminFetch(`/admin/locations/${id}`, adminLocationSummaryDtoSchema);
}

/** `POST /admin/locations`. `F3.86` PR 3a: the body is the route's own (`@bms/shared`, ADR 0030). */
export async function createAdminLocation(input: CreateLocationBody): Promise<AdminLocationDto> {
  return adminFetch("/admin/locations", adminLocationDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * `PATCH /admin/locations/:id`. `F2.10` (ADR 0098 decision 12) — `parentId` is a move: send the
 * key only when the parent changed and the role may move, since any body that names it is a 403
 * below the organization level.
 */
export async function updateAdminLocation(id: string, input: UpdateLocationBody): Promise<AdminLocationDto> {
  return adminFetch(`/admin/locations/${id}`, adminLocationDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminLocation(id: string): Promise<AdminLocationDto> {
  return adminFetch(`/admin/locations/${id}/deactivate`, adminLocationDtoSchema, { method: "POST" });
}

export async function reactivateAdminLocation(id: string): Promise<AdminLocationDto> {
  return adminFetch(`/admin/locations/${id}/reactivate`, adminLocationDtoSchema, { method: "POST" });
}

/** `GET /admin/locations/:id/control-room-view` — the stored setting, or the no-row default
 * (`kind: "generated"`, every optional field `null`). */
export async function fetchSiteControlRoomView(id: string): Promise<SiteControlRoomViewSettingDto> {
  return adminFetch(`/admin/locations/${id}/control-room-view`, siteControlRoomViewSettingDtoSchema);
}

/** `PUT /admin/locations/:id/control-room-view`. A `builtin` body from any role but the global
 * `admin` answers 403 (plan OQ1), and so does any body from those roles when the site's stored
 * view is `builtin` (OQ3); an ineligible dashboard answers 400. */
export async function putSiteControlRoomView(
  id: string,
  body: PutSiteControlRoomViewBody,
): Promise<SiteControlRoomViewSettingDto> {
  return adminFetch(`/admin/locations/${id}/control-room-view`, siteControlRoomViewSettingDtoSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
