import type { AdminAssetPointDto, MasterDataActiveFilter } from "@bms/shared";

import { adminFetch } from "./client";

export type AssetPointsListResponse = { items: AdminAssetPointDto[] };

export async function fetchAdminAssetPoints(
  active: MasterDataActiveFilter = "all",
  assetId?: string,
  locationId?: string,
): Promise<AssetPointsListResponse> {
  const params = new URLSearchParams({ active });
  if (assetId) {
    params.set("assetId", assetId);
  }
  if (locationId) {
    params.set("locationId", locationId);
  }
  return adminFetch(`/admin/asset-points?${params}`);
}

export async function createAdminAssetPoint(input: {
  assetId: string;
  pointKey: string;
  sourceDataKey: string;
  sensorCode?: string;
  unit?: string;
}): Promise<AdminAssetPointDto> {
  return adminFetch("/admin/asset-points", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminAssetPoint(
  id: string,
  input: Partial<{
    pointKey: string;
    sourceDataKey: string;
    sensorCode: string;
    unit: string;
  }>,
): Promise<AdminAssetPointDto> {
  return adminFetch(`/admin/asset-points/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminAssetPoint(
  id: string,
): Promise<AdminAssetPointDto> {
  return adminFetch(`/admin/asset-points/${id}/deactivate`, { method: "POST" });
}

export async function reactivateAdminAssetPoint(
  id: string,
): Promise<AdminAssetPointDto> {
  return adminFetch(`/admin/asset-points/${id}/reactivate`, { method: "POST" });
}
