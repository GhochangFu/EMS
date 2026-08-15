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

/** GET /api/v1/assets */
export async function fetchAssets(): Promise<AssetRow[]> {
  const res = await fetch(`${base}/api/v1/assets`, withAuth());
  if (!res.ok) {
    throw new Error(`assets ${res.status}`);
  }
  return checkResponse(assetPickerResponseSchema, await res.json(), "assets");
}
