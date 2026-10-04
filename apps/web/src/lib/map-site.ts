import type { MapSiteDto } from "@bms/shared";

import { siteAssetsPath } from "./smoc-pages";

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

/**
 * `F3.79` — the organization's own pins, for the Control Room's organization
 * level. A pin carries an organization only through its join to a location
 * (`map.service.ts`), so these are the organization's operational sites; a
 * reference station, which joins none, never matches.
 */
export function organizationPins(
  sites: readonly MapSiteDto[],
  organizationId: string,
): MapSiteDto[] {
  return sites.filter((site) => site.organization?.id === organizationId);
}

/** The link at the foot of a map pin's popup. */
export type MapSiteLink = { to: string; label: string };

/** The Sites map's popup link: the site's Assets & RTUs tab (`F3.72` OQ9). */
export function estateSiteLink(site: MapSiteDto): MapSiteLink {
  return {
    to: site.canonicalLocationId ? siteAssetsPath(site.canonicalLocationId) : "/",
    label: "Dashboard",
  };
}

/**
 * `F3.79` — the org site map's popup link: the next drill-down level, the site's overview.
 * `organizationPins` keeps only pins that join a location, so the `/control-room` fallback is
 * not reached from the org site map; it keeps the function total over `MapSiteDto`.
 */
export function controlRoomSiteLink(site: MapSiteDto): MapSiteLink {
  return {
    to: site.canonicalLocationId
      ? `/control-room/site/${encodeURIComponent(site.canonicalLocationId)}`
      : "/control-room",
    label: "Open site",
  };
}
