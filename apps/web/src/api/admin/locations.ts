import type { AdminLocationDto, AdminLocationSummaryDto, MasterDataActiveFilter } from "@bms/shared";

import { adminFetch } from "./client";

export type LocationsListResponse = { items: AdminLocationDto[] };

export async function fetchAdminLocations(
  active: MasterDataActiveFilter = "all",
  organizationId?: string,
): Promise<LocationsListResponse> {
  const params = new URLSearchParams({ active });
  if (organizationId) {
    params.set("organizationId", organizationId);
  }
  return adminFetch(`/admin/locations?${params}`);
}

export async function fetchAdminLocationSummary(
  id: string,
): Promise<AdminLocationSummaryDto> {
  return adminFetch(`/admin/locations/${id}`);
}

export async function createAdminLocation(input: {
  organizationId: string;
  code: string;
  slug: string;
  name: string;
  type: AdminLocationDto["type"];
  province?: string | null;
  capital?: string | null;
  latitude: number;
  longitude: number;
  meta?: Record<string, unknown>;
}): Promise<AdminLocationDto> {
  return adminFetch("/admin/locations", {
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
    latitude: number;
    longitude: number;
  }>,
): Promise<AdminLocationDto> {
  return adminFetch(`/admin/locations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminLocation(id: string): Promise<AdminLocationDto> {
  return adminFetch(`/admin/locations/${id}/deactivate`, { method: "POST" });
}

export async function reactivateAdminLocation(id: string): Promise<AdminLocationDto> {
  return adminFetch(`/admin/locations/${id}/reactivate`, { method: "POST" });
}
