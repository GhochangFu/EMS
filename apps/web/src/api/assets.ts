import type { AssetListRow } from "@bms/shared";
import {
  assetListResponseSchema,
} from "@bms/shared/contracts";
import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `GET /api/v1/assets`'s row, widened by ADR 0068 decision 2 (`F3.31`). Two
 * consumers: the affected-asset picker (`lib/asset-picker.ts`, ADR 0034
 * decision 4), which reads only its original five fields, and the `/assets`
 * operator browser (`F3.31`), which reads all of them.
 */
export type AssetRow = AssetListRow;

/**
 * GET /api/v1/assets, optionally narrowed to one organization — the
 * affected-asset picker (`alarm-details-panel.tsx`, ADR 0034 decision 4)
 * passes the alarm's own `organizationId` so its candidate list does not mix
 * assets across organizations.
 */
export async function fetchAssets(organizationId?: string): Promise<AssetRow[]> {
  const params = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
  const res = await fetch(`${base}/api/v1/assets${params}`, withAuth());
  if (!res.ok) {
    throw new Error(`assets ${res.status}`);
  }
  return checkResponse(assetListResponseSchema, await res.json(), "assets");
}
