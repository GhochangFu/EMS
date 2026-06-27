import type { AdminRtuDto, AdminRtuSummaryDto, MasterDataActiveFilter } from "@bms/shared";

import { adminFetch } from "./client";

export type RtusListResponse = { items: AdminRtuDto[] };

export async function fetchAdminRtus(
  active: MasterDataActiveFilter = "all",
  locationId?: string,
): Promise<RtusListResponse> {
  const params = new URLSearchParams({ active });
  if (locationId) {
    params.set("locationId", locationId);
  }
  return adminFetch(`/admin/rtus?${params}`);
}

export async function fetchAdminRtuSummary(id: string): Promise<AdminRtuSummaryDto> {
  return adminFetch(`/admin/rtus/${id}`);
}

export async function createAdminRtu(
  input: {
    locationId: string;
    code: string;
    displayName: string;
    sourceType: AdminRtuDto["sourceType"];
    domain?: string;
    externalRtuId?: number;
    mqttTopic?: string;
    ingestEnabled?: boolean;
  },
): Promise<AdminRtuDto> {
  return adminFetch("/admin/rtus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminRtu(
  id: string,
  input: Partial<{
    code: string;
    displayName: string;
    sourceType: AdminRtuDto["sourceType"];
    domain: string;
    ingestEnabled: boolean;
  }>,
): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminRtu(id: string): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${id}/deactivate`, { method: "POST" });
}

export async function reactivateAdminRtu(id: string): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${id}/reactivate`, { method: "POST" });
}
