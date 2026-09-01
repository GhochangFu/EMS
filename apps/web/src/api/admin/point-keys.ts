import {
  adminPointKeyDtoSchema,
  pointKeysListResponseSchema,
} from "@bms/shared/contracts";
import type { AdminPointKeyDto, MasterDataActiveFilter, PointKeysListResponse } from "@bms/shared";

import { activeQuery, adminFetch } from "./client";


/**
 * `F3.39` / ADR 0051 — one fleet-wide catalog, so no `organizationId` filter.
 */
export async function fetchAdminPointKeys(
  active: MasterDataActiveFilter = "all",
): Promise<PointKeysListResponse> {
  const params = new URLSearchParams(activeQuery(active));
  return adminFetch(`/admin/point-keys?${params}`, pointKeysListResponseSchema);
}

export async function fetchAdminPointKey(id: string): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}`, adminPointKeyDtoSchema);
}

export async function createAdminPointKey(input: {
  code: string;
  name: string;
  domain?: string;
  unit?: string;
  description?: string;
}): Promise<AdminPointKeyDto> {
  return adminFetch("/admin/point-keys", adminPointKeyDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminPointKey(
  id: string,
  input: Partial<{
    name: string;
    domain: string;
    unit: string;
    description: string;
  }>,
): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}`, adminPointKeyDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminPointKey(id: string): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}/deactivate`, adminPointKeyDtoSchema, { method: "POST" });
}

export async function reactivateAdminPointKey(id: string): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}/reactivate`, adminPointKeyDtoSchema, { method: "POST" });
}
