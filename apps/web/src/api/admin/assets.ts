import type { AdminAssetDto, AdminAssetSummaryDto, MasterDataActiveFilter } from "@bms/shared";

import { adminFetch } from "./client";

export type AssetsListResponse = { items: AdminAssetDto[] };

export async function fetchAdminAssets(
  active: MasterDataActiveFilter = "all",
  locationId?: string,
  rtuId?: string,
): Promise<AssetsListResponse> {
  const params = new URLSearchParams({ active });
  if (locationId) {
    params.set("locationId", locationId);
  }
  if (rtuId) {
    params.set("rtuId", rtuId);
  }
  return adminFetch(`/admin/assets?${params}`);
}

export async function fetchAdminAssetSummary(id: string): Promise<AdminAssetSummaryDto> {
  return adminFetch(`/admin/assets/${id}`);
}

export async function createAdminAsset(input: {
  code: string;
  name: string;
  siteName: string;
  locationId: string;
  // ADR 0018: optional — null means the asset has no gateway.
  rtuId?: string | null;
  domain: string;
}): Promise<AdminAssetDto> {
  return adminFetch("/admin/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminAsset(
  id: string,
  input: Partial<{
    code: string;
    name: string;
    siteName: string;
    locationId: string;
    // ADR 0018: optional — null means the asset has no gateway.
  rtuId?: string | null;
    domain: string;
  }>,
): Promise<AdminAssetDto> {
  return adminFetch(`/admin/assets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminAsset(id: string): Promise<AdminAssetDto> {
  return adminFetch(`/admin/assets/${id}/deactivate`, { method: "POST" });
}

export async function reactivateAdminAsset(id: string): Promise<AdminAssetDto> {
  return adminFetch(`/admin/assets/${id}/reactivate`, { method: "POST" });
}
