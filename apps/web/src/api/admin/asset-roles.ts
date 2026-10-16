import { assetRoleDtoSchema } from "@bms/shared/contracts";
import type { AssetRoleDto, CreateAssetRoleBody } from "@bms/shared";

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
