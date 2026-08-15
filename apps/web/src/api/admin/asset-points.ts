import {
  adminAssetPointDtoSchema,
  assetPointsListResponseSchema,
} from "@bms/shared/contracts";
import type { AdminAssetPointDto, MasterDataActiveFilter, AssetPointsListResponse } from "@bms/shared";

import { adminFetch } from "./client";

export type { AssetPointsListResponse };


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
  return adminFetch(`/admin/asset-points?${params}`, assetPointsListResponseSchema);
}

export async function createAdminAssetPoint(input: {
  assetId: string;
  pointKey: string;
  sourceDataKey: string;
  sensorCode?: string;
  unit?: string;
}): Promise<AdminAssetPointDto> {
  return adminFetch("/admin/asset-points", adminAssetPointDtoSchema, {
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
  return adminFetch(`/admin/asset-points/${id}`, adminAssetPointDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deactivateAdminAssetPoint(
  id: string,
): Promise<AdminAssetPointDto> {
  return adminFetch(`/admin/asset-points/${id}/deactivate`, adminAssetPointDtoSchema, { method: "POST" });
}

export async function reactivateAdminAssetPoint(
  id: string,
): Promise<AdminAssetPointDto> {
  return adminFetch(`/admin/asset-points/${id}/reactivate`, adminAssetPointDtoSchema, { method: "POST" });
}
