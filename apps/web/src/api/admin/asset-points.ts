import {
  adminAssetPointDtoSchema,
  assetPointCalcConfigDtoSchema,
  assetPointCalcConfigListResponseSchema,
  assetPointsListResponseSchema,
} from "@bms/shared/contracts";
import type {
  AdminAssetPointDto,
  AssetPointCalcConfigDto,
  AssetPointCalcConfigListResponse,
  AssetPointCalcOverrideFields,
  MasterDataActiveFilter,
  AssetPointsListResponse,
} from "@bms/shared";

import { adminFetch } from "./client";

export type { AssetPointsListResponse, AssetPointCalcConfigDto, AssetPointCalcConfigListResponse };


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

/**
 * `F2.6` — this asset's derived points, with template, override and effective
 * values (ADR 0039 decision 8).
 *
 * Hangs off `admin/assets/:assetId`, not `admin/asset-points`: the subject is
 * an asset. Only derived points appear — a measured point has no calc
 * configuration to override.
 */
export async function fetchAdminAssetCalcPoints(
  assetId: string,
): Promise<AssetPointCalcConfigListResponse> {
  return adminFetch(
    `/admin/assets/${assetId}/calc-points`,
    assetPointCalcConfigListResponseSchema,
  );
}

/**
 * Sets the whole override. `null` per column means "inherit".
 *
 * `PUT`, not `PATCH`: a partial update would need a second spelling of "leave
 * this alone" that the server cannot tell from "clear this one". Clearing is
 * `deleteAdminAssetPointCalcOverride`.
 */
export async function setAdminAssetPointCalcOverride(
  assetId: string,
  pointKey: string,
  body: AssetPointCalcOverrideFields,
): Promise<AssetPointCalcConfigDto> {
  return adminFetch(
    `/admin/assets/${assetId}/calc-points/${encodeURIComponent(pointKey)}`,
    assetPointCalcConfigDtoSchema,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

/** Clears all five columns back to inheriting. The `asset_points` row survives. */
export async function clearAdminAssetPointCalcOverride(
  assetId: string,
  pointKey: string,
): Promise<AssetPointCalcConfigDto> {
  return adminFetch(
    `/admin/assets/${assetId}/calc-points/${encodeURIComponent(pointKey)}`,
    assetPointCalcConfigDtoSchema,
    { method: "DELETE" },
  );
}
