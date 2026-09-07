import {
  adminAssetPointDtoSchema,
  assetPointCalcConfigDtoSchema,
  assetPointCalcConfigListResponseSchema,
  assetPointsListResponseSchema,
  mappingSheetCommitDtoSchema,
  mappingSheetPreviewDtoSchema,
} from "@bms/shared/contracts";
import type {
  AdminAssetPointDto,
  AssetPointCalcConfigDto,
  AssetPointCalcConfigListResponse,
  AssetPointCalcOverrideFields,
  MappingSheetCommitDto,
  MappingSheetPreviewDto,
  MasterDataActiveFilter,
  PointMetadataFields,
  AssetPointsListResponse,
} from "@bms/shared";

import { clearSessionOnAuthFailure } from "../http";
import { readJson } from "../validate";
import { adminFetch, getAdminAuthHeaders } from "./client";
import type { AssetPointBulkPatch } from "../../lib/asset-point-bulk-edit";
import { describeMappingSheetUploadError } from "../../lib/mapping-sheet-preview";

export type { AssetPointsListResponse, AssetPointCalcConfigDto, AssetPointCalcConfigListResponse };

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F2.7` / ADR 0056 decision 1 — the five metadata columns on a **write**: each
 * one optional (leave it), `null` (clear it back to the template default) or a
 * value. `PointMetadataFields` is the read shape, where all five are required
 * and nullable, so it is made partial rather than restated field by field.
 */
type PointMetadataWrite = Partial<{ [K in keyof PointMetadataFields]: PointMetadataFields[K] }>;


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

/**
 * A new mapping. `rtuId` is optional (ADR 0056 decision 3): a uuid wires the
 * point and makes it `measured`, its absence leaves it `unmapped`. The five
 * metadata fields are omitted when the form leaves them empty — an omitted
 * field and an explicit `null` mean the same thing on a create, and omitting
 * keeps the request the shape it had before `F2.7`.
 */
export type CreateAdminAssetPointInput = {
  assetId: string;
  pointKey: string;
  sourceDataKey: string;
  sensorCode?: string;
  unit?: string;
  rtuId?: string;
} & PointMetadataWrite;

/**
 * An edit. Every key is optional and absent means "leave it"; `null` on
 * `rtuId` unwires the point (`measured` → `unmapped`, a `manual` row stays
 * `manual`), and `null` on one of the five clears the per-asset override back
 * to the template default (owner ruling Q-H, plan design decision 14).
 */
export type UpdateAdminAssetPointInput = Partial<{
  pointKey: string;
  sourceDataKey: string;
  sensorCode: string;
  unit: string;
  rtuId: string | null;
}> &
  PointMetadataWrite;

export async function createAdminAssetPoint(
  input: CreateAdminAssetPointInput,
): Promise<AdminAssetPointDto> {
  return adminFetch("/admin/asset-points", adminAssetPointDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateAdminAssetPoint(
  id: string,
  input: UpdateAdminAssetPointInput,
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

/**
 * `F2.7` / ADR 0056 decision 8 — one patch over a selection, all or nothing.
 *
 * The response is the **written rows in the list envelope**, so the panel can
 * show what it changed rather than a bare count, and a refusal is an `ApiError`
 * carrying the server's sentence — which names the offending row and the bound
 * it inherited from its template.
 */
export async function bulkUpdateAdminAssetPoints(body: {
  ids: readonly string[];
  patch: AssetPointBulkPatch;
}): Promise<AssetPointsListResponse> {
  return adminFetch("/admin/asset-points/bulk-update", assetPointsListResponseSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * `F2.7` / ADR 0056 decision 6 — one location's `MAPPINGS` workbook.
 *
 * The blob and the server's filename are returned rather than downloaded here:
 * an object URL and a synthetic click are a DOM act, and this module is the
 * transport. The name comes from `Content-Disposition` because the service
 * builds it from the location code (`mapping-sheet-<CODE>.xlsx`); the fallback
 * is used when a proxy strips the header, never a name invented per call site.
 */
export async function downloadMappingSheet(
  locationId: string,
): Promise<{ blob: Blob; filename: string }> {
  const headers = getAdminAuthHeaders();
  const res = await fetch(
    `${base}/api/v1/admin/asset-points/mapping-sheet.xlsx?locationId=${encodeURIComponent(locationId)}`,
    { headers },
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new Error(text.trim() || `Mapping sheet download failed (${res.status}).`);
  }
  return {
    blob: await res.blob(),
    filename: filenameFromContentDisposition(res.headers.get("Content-Disposition")),
  };
}

/** `attachment; filename="mapping-sheet-CR.xlsx"` → `mapping-sheet-CR.xlsx`. */
function filenameFromContentDisposition(header: string | null): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match?.[1]?.trim() || "mapping-sheet.xlsx";
}

/** The multipart body both import routes take: one `file` part, `locationId` in the query. */
function mappingSheetForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

/**
 * `F2.7` / ADR 0056 decision 7 — parses an uploaded sheet and writes nothing.
 *
 * A file-level refusal is a 400 whose body is one `MappingSheetErrorDto`
 * (design decision 7), so the message is built by
 * {@link describeMappingSheetUploadError} rather than shown raw.
 */
export async function previewMappingSheet(
  locationId: string,
  file: File,
): Promise<MappingSheetPreviewDto> {
  const res = await fetch(
    `${base}/api/v1/admin/asset-points/mapping-sheet/preview?locationId=${encodeURIComponent(locationId)}`,
    { method: "POST", headers: getAdminAuthHeaders(), body: mappingSheetForm(file) },
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(describeMappingSheetUploadError(res.status, await res.text()));
  }
  return readJson(res, mappingSheetPreviewDtoSchema, "admin asset-points mapping-sheet preview");
}

/** Writes every valid row of the sheet in one transaction and returns what it skipped (Q5). */
export async function commitMappingSheet(
  locationId: string,
  file: File,
): Promise<MappingSheetCommitDto> {
  const res = await fetch(
    `${base}/api/v1/admin/asset-points/mapping-sheet/commit?locationId=${encodeURIComponent(locationId)}`,
    { method: "POST", headers: getAdminAuthHeaders(), body: mappingSheetForm(file) },
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(describeMappingSheetUploadError(res.status, await res.text()));
  }
  return readJson(res, mappingSheetCommitDtoSchema, "admin asset-points mapping-sheet commit");
}
