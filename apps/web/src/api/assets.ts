import {
  assetPickerResponseSchema,
} from "@bms/shared/contracts";
import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type AssetRow = {
  id: string;
  code: string;
  name: string;
  siteName: string;
  domain: string;
};

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
  return checkResponse(assetPickerResponseSchema, await res.json(), "assets");
}
