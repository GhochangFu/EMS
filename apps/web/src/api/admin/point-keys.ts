import type { AdminPointKeyDto, MasterDataActiveFilter } from "@bms/shared";

import { activeQuery, adminFetch } from "./client";

export type PointKeysListResponse = { items: AdminPointKeyDto[] };

export async function fetchAdminPointKeys(
  active: MasterDataActiveFilter = "all",
  organizationId?: string,
): Promise<PointKeysListResponse> {
  const params = new URLSearchParams(activeQuery(active));
  if (organizationId) {
    params.set("organizationId", organizationId);
  }
  return adminFetch(`/admin/point-keys?${params}`);
}

export async function fetchAdminPointKey(id: string): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}`);
}

export async function createAdminPointKey(input: {
  organizationId: string;
  code: string;
  name: string;
  domain?: string;
  unit?: string;
  description?: string;
}): Promise<AdminPointKeyDto> {
  return adminFetch("/admin/point-keys", {
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
  return adminFetch(`/admin/point-keys/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminPointKey(id: string): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}/deactivate`, { method: "POST" });
}

export async function reactivateAdminPointKey(id: string): Promise<AdminPointKeyDto> {
  return adminFetch(`/admin/point-keys/${id}/reactivate`, { method: "POST" });
}
