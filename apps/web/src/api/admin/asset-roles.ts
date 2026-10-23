import { assetRoleDtoSchema, assetRolesListResponseSchema } from "@bms/shared/contracts";
import type { AssetRoleDto, AssetRolesListResponse, CreateAssetRoleBody, UpdateAssetRoleBody } from "@bms/shared";

import { adminFetch } from "./client";

/**
 * `F3.87` PR 6b (ADR 0099 Amendment 3 A1, ruling Q2) — `POST
 * /api/v1/admin/vocabularies/asset-roles`, the global administrator's unit-role
 * create (`F3.40`, ADR 0051 decision 5). The response is the vocabulary's own
 * row shape, `assetRoleDtoSchema`, which `GET /api/v1/vocabularies` serves.
 */
export async function createAssetRole(body: CreateAssetRoleBody): Promise<AssetRoleDto> {
  return adminFetch("/admin/vocabularies/asset-roles", assetRoleDtoSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * `F4.282` (ADR 0099 Amendment 8 Q17) — `GET /api/v1/admin/vocabularies/asset-roles`, the
 * global administrator's catalog of unit roles, active and retired, for the Unit Roles page.
 */
export async function fetchAssetRoleCatalog(): Promise<AssetRolesListResponse> {
  return adminFetch("/admin/vocabularies/asset-roles", assetRolesListResponseSchema);
}

/**
 * `F4.282` — `PATCH /api/v1/admin/vocabularies/asset-roles/:code`: an edit of label and sort
 * order, or a retire / restore through `active` (ADR 0051 decision 5).
 */
export async function updateAssetRole(code: string, body: UpdateAssetRoleBody): Promise<AssetRoleDto> {
  return adminFetch(`/admin/vocabularies/asset-roles/${encodeURIComponent(code)}`, assetRoleDtoSchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
