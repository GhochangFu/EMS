import {
  adminLocationDtoSchema,
  adminLocationSummaryDtoSchema,
  locationsListResponseSchema,
  siteControlRoomViewSettingDtoSchema,
} from "@bms/shared/contracts";
import type {
  AdminLocationDto,
  AdminLocationSummaryDto,
  BuiltinSiteViewKey,
  LocationsListResponse,
  MasterDataActiveFilter,
  SiteControlRoomViewSettingDto,
} from "@bms/shared";

import { adminFetch } from "./client";

export type { LocationsListResponse };


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

export async function createAdminLocation(input: {
  organizationId: string;
  code: string;
  slug: string;
  name: string;
  type: AdminLocationDto["type"];
  province?: string | null;
  capital?: string | null;
  /** E4.1b: IANA zone name; the server validates it against pg_timezone_names. */
  timezone?: string | null;
  latitude: number;
  longitude: number;
  meta?: Record<string, unknown>;
}): Promise<AdminLocationDto> {
  return adminFetch("/admin/locations", adminLocationDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminLocation(
  id: string,
  input: Partial<{
    code: string;
    slug: string;
    name: string;
    type: AdminLocationDto["type"];
    province: string | null;
    capital: string | null;
    timezone: string | null;
    latitude: number;
    longitude: number;
  }>,
): Promise<AdminLocationDto> {
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

/**
 * `F3.67` / ADR 0076 decision 5 — `PUT /admin/locations/:id/control-room-view`'s body.
 * Declared locally (`apps/web` does not depend on `apps/api`), mirroring
 * `putSiteControlRoomViewBodySchema` (`apps/api/src/control-room/site-control-room-view.schema.ts`).
 * That schema is `.strict()` with a two-way pair rule, so the union admits exactly the three
 * shapes it accepts and no stray key.
 */
export type PutSiteControlRoomViewPayload =
  | { kind: "generated" }
  | { kind: "dashboard"; dashboardId: string }
  | { kind: "builtin"; builtinKey: BuiltinSiteViewKey };

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
  body: PutSiteControlRoomViewPayload,
): Promise<SiteControlRoomViewSettingDto> {
  return adminFetch(`/admin/locations/${id}/control-room-view`, siteControlRoomViewSettingDtoSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
