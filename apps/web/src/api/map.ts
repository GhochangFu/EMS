import {
  mapSitesResponseSchema,
} from "@bms/shared/contracts";
import type { MapSiteDto } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `GET /map/sites`. `F2.10` (ADR 0098 decision 11, B4, B12): `parentLocationId` narrows the
 * pins to that node's subtree and drops the pins that join no location.
 */
export async function fetchMapSites(parentLocationId?: string): Promise<MapSiteDto[]> {
  const query = parentLocationId
    ? `?parentLocationId=${encodeURIComponent(parentLocationId)}`
    : "";
  const res = await fetch(`${base}/api/v1/map/sites${query}`, withAuth());
  if (!res.ok) {
    throw new Error(`map sites ${res.status}`);
  }
  return checkResponse(mapSitesResponseSchema, await res.json(), "map/sites");
}
