import type {
  AssetListRow,
  AssetPointPickerListResponse,
  AssetRoleSummaryResponse,
} from "@bms/shared";
import {
  assetListResponseSchema,
  assetPointPickerListResponseSchema,
  assetRoleSummaryResponseSchema,
} from "@bms/shared/contracts";
import { clearSessionOnAuthFailure, withAuth } from "./http";
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
 * `GET /api/v1/assets/:assetId/points` — one asset's active points, five
 * fields each (`AssetPointPickerRow`: `id`, `assetId`, `assetName`,
 * `pointKey`, `unit` — `F3.63`, ADR 0047 Amendment 6 §Q1 point 3). NOT the
 * admin list's `AdminAssetPointDto`: the route is gated server-side on
 * `canReadAsset`, not on the master-data roles, so every read-scoped role
 * reaches it, and the admin projection's ingest wiring and scaling overrides
 * are not for them. It is the point read `PointPicker` uses for an
 * `asset_group_admin`, who `GET /admin/asset-points` refuses. Same
 * `fetch` + `withAuth` + `checkResponse` shape as `fetchAssets` above; the
 * envelope is `{ items }` (`assetPointPickerListResponseSchema`), where
 * `fetchAssets`'s is a bare array.
 */
export async function fetchAssetPoints(assetId: string): Promise<AssetPointPickerListResponse> {
  const res = await fetch(`${base}/api/v1/assets/${encodeURIComponent(assetId)}/points`, withAuth());
  if (!res.ok) {
    throw new Error(`asset points ${res.status}`);
  }
  return checkResponse(assetPointPickerListResponseSchema, await res.json(), "asset points");
}

/**
 * `GET /api/v1/assets/role-summary` — per asset role: how many assets hold it,
 * the worst active severity among them and how many sit at it, and how many
 * are offline (`F3.28`, ADR 0074, owner rulings OQ4 and OQ6). The source of
 * the `/cr-overview` class strip.
 *
 * `assetIds` goes on the wire as one repeated parameter per id (plan decision
 * 1). The server only ever intersects it with the caller's readable set.
 */
export async function fetchAssetRoleSummary(
  assetIds: readonly string[] = [],
): Promise<AssetRoleSummaryResponse> {
  const params = new URLSearchParams();
  for (const id of assetIds) {
    params.append("assetIds", id);
  }
  const res = await fetch(`${base}/api/v1/assets/role-summary?${params}`, withAuth());
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`assets/role-summary ${res.status}`);
  }
  return checkResponse(assetRoleSummaryResponseSchema, await res.json(), "assets/role-summary");
}
