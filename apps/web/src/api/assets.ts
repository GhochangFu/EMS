import type { AssetListRow, AssetPointsListResponse } from "@bms/shared";
import {
  assetListResponseSchema,
  assetPointsListResponseSchema,
} from "@bms/shared/contracts";
import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `GET /api/v1/assets`'s row, widened by ADR 0068 decision 2 (`F3.31`). Two
 * consumers: the affected-asset picker (`lib/asset-picker.ts`, ADR 0034
 * decision 4), which reads only its original five fields, and the `/asset-browser`
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

/**
 * `GET /api/v1/assets/:assetId/points` — one asset's active points, in the
 * admin list's `AdminAssetPointDto` shape (`F3.63`, ADR 0047 Amendment 6 §Q1
 * point 3). Gated server-side on `canReadAsset`, not on the master-data
 * roles, so it is the point read `PointPicker` uses for an
 * `asset_group_admin`, who `GET /admin/asset-points` refuses. Same
 * `fetch` + `withAuth` + `checkResponse` shape as `fetchAssets` above; the
 * envelope is `{ items }` (`assetPointsListResponseSchema`), where
 * `fetchAssets`'s is a bare array.
 */
export async function fetchAssetPoints(assetId: string): Promise<AssetPointsListResponse> {
  const res = await fetch(`${base}/api/v1/assets/${encodeURIComponent(assetId)}/points`, withAuth());
  if (!res.ok) {
    throw new Error(`asset points ${res.status}`);
  }
  return checkResponse(assetPointsListResponseSchema, await res.json(), "asset points");
}
