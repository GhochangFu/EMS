import {
  adminRtuDtoSchema,
  adminRtuSummaryDtoSchema,
  rtusListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminRtuDto,
  AdminRtuSummaryDto,
  CreateRtuBody,
  MasterDataActiveFilter,
  RtusListResponse,
  UpdateRtuBody,
} from "@bms/shared";

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

/** `POST /admin/rtus`. `F3.86` PR 3a: the body is the route's own (`@bms/shared`, ADR 0030). */
export async function createAdminRtu(input: CreateRtuBody): Promise<AdminRtuDto> {
  return adminFetch("/admin/rtus", adminRtuDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * `PATCH /admin/rtus/:id`. `""` clears `rtuCode`: the body is optional-but-not-nullable
 * (`rtu-writes.ts`, `F4.60`), so omit a key to leave it unchanged.
 */
export async function updateAdminRtu(id: string, input: UpdateRtuBody): Promise<AdminRtuDto> {
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
