import {
  mapSitesResponseSchema,
} from "@bms/shared/contracts";
import type { MapSiteDto } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchMapSites(): Promise<MapSiteDto[]> {
  const res = await fetch(`${base}/api/v1/map/sites`, withAuth());
  if (!res.ok) {
    throw new Error(`map sites ${res.status}`);
  }
  return checkResponse(mapSitesResponseSchema, await res.json(), "map/sites");
}
