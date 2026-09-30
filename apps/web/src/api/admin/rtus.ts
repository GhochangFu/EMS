import {
  adminRtuDtoSchema,
  adminRtuSummaryDtoSchema,
  rtusListResponseSchema,
} from "@bms/shared/contracts";
import type { AdminRtuDto, AdminRtuSummaryDto, MasterDataActiveFilter, RtusListResponse } from "@bms/shared";

import { adminFetch } from "./client";

export type { RtusListResponse };


export async function fetchAdminRtus(
  active: MasterDataActiveFilter = "all",
  locationId?: string,
): Promise<RtusListResponse> {
  const params = new URLSearchParams({ active });
  if (locationId) {
    params.set("locationId", locationId);
  }
  return adminFetch(`/admin/rtus?${params}`, rtusListResponseSchema);
}

export async function fetchAdminRtuSummary(id: string): Promise<AdminRtuSummaryDto> {
  return adminFetch(`/admin/rtus/${id}`, adminRtuSummaryDtoSchema);
}

export async function createAdminRtu(
  input: {
    locationId: string;
    code: string;
    displayName: string;
    sourceType: AdminRtuDto["sourceType"];
    domain?: string;
    externalRtuId?: number;
    rtuCode?: string;
    mqttTopic?: string;
    ingestEnabled?: boolean;
  },
): Promise<AdminRtuDto> {
  return adminFetch("/admin/rtus", adminRtuDtoSchema, {
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
    // `""` clears the column: the PATCH body is optional-but-not-nullable
    // (`rtus.schema.ts`, `F4.60`), so omit the key to leave it unchanged.
    rtuCode: string;
    ingestEnabled: boolean;
  }>,
): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${id}`, adminRtuDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminRtu(id: string): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${id}/deactivate`, adminRtuDtoSchema, { method: "POST" });
}

export async function reactivateAdminRtu(id: string): Promise<AdminRtuDto> {
  return adminFetch(`/admin/rtus/${id}/reactivate`, adminRtuDtoSchema, { method: "POST" });
}
