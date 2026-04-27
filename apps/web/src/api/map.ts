import type { MapSiteDto } from "@bms/shared";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export async function fetchMapSites(): Promise<MapSiteDto[]> {
  const res = await fetch(`${base}/api/v1/map/sites`);
  if (!res.ok) {
    throw new Error(`map sites ${res.status}`);
  }
  return res.json() as Promise<MapSiteDto[]>;
}
