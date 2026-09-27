import type { MapSiteDto } from "@bms/shared";

/**
 * `F4.157` (ADR 0077, D8) — a map pin is operational (a larger marker, live
 * health from alarms and telemetry) when it joins a `bms.locations` row. The
 * API makes the same decision in `map.service.ts`; the location type is data
 * (`bms.location_types`), so no list of type codes decides it here.
 */
export function isOperationalSite(site: MapSiteDto): boolean {
  return site.canonicalLocationId !== null;
}

/**
 * `F4.163` — the base map is the standard OpenStreetMap tile layer. The CARTO
 * `dark_all` basemap it replaces now answers every tile with an "API key
 * required" image. OpenStreetMap's tile policy requires this attribution and
 * allows light use only; a production deployment with heavy traffic points
 * `url` at its own tile server.
 */
export const MAP_TILE = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
} as const;

/** `[[south, west], [north, east]]`, the shape Leaflet's `fitBounds` takes. */
export type SiteBounds = [[number, number], [number, number]];

/**
 * `F4.163` — the box the map opens on: the caller's own sites. The pins that
 * join a location (the organization's sites) decide it when there are any, so
 * a PHEWB user opens on West Bengal instead of South Africa; otherwise every
 * pin does. `null` when there is nothing to show.
 */
export function siteBounds(sites: readonly MapSiteDto[]): SiteBounds | null {
  const operational = sites.filter(isOperationalSite);
  const shown = operational.length > 0 ? operational : sites;
  if (shown.length === 0) {
    return null;
  }
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const s of shown) {
    south = Math.min(south, s.latitude);
    north = Math.max(north, s.latitude);
    west = Math.min(west, s.longitude);
    east = Math.max(east, s.longitude);
  }
  return [
    [south, west],
    [north, east],
  ];
}
