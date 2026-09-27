import type { MapSiteDto } from "@bms/shared";

import { isOperationalSite, MAP_TILE, siteBounds } from "./map-site";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A complete `MapSiteDto`; each case overrides only what it is about. */
function site(overrides: Partial<MapSiteDto>): MapSiteDto {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    canonicalLocationId: null,
    slug: "f4157-site",
    name: "F4.157 site",
    kind: "eskom_station",
    kindLabel: "Station",
    siteName: null,
    organization: null,
    latitude: 0,
    longitude: 0,
    capacityMw: null,
    stationType: null,
    stationCategory: null,
    province: null,
    stationOperatingStatus: null,
    live: { status: "unknown", openAlarms: 0, criticalAlarms: 0, assetsTotal: 0, assetsFresh: 0 },
    ...overrides,
  };
}

/**
 * `F4.157` (ADR 0077, D8) W1 — a pin that joins a location is operational
 * whatever its type. A `pump_station` pin is outside the old three-literal
 * test, so restoring that test turns this red.
 */
export function runOperationalSiteJoinedPumpStationTest(): void {
  const joined = site({
    canonicalLocationId: "00000000-0000-0000-0000-0000000000aa",
    kind: "pump_station",
    kindLabel: "Pump station",
  });
  assert(
    isOperationalSite(joined) === true,
    "a pin with a canonicalLocationId is operational even when its kind is pump_station",
  );
}

/**
 * `F4.157` W2 — a pin that joins no location is not operational, even when its
 * kind is one of the three old literals.
 */
export function runOperationalSiteUnjoinedRsmocTest(): void {
  const unjoined = site({ canonicalLocationId: null, kind: "rsmoc", kindLabel: "RSMOC" });
  assert(
    isOperationalSite(unjoined) === false,
    "a pin with no canonicalLocationId is not operational, whatever its kind",
  );
}

/**
 * `F4.163` T1 — the base map is the standard OpenStreetMap tile layer. The
 * CARTO basemap answered every tile with an "API key required" image.
 */
export function runMapTileIsOpenStreetMapTest(): void {
  const host = new URL(MAP_TILE.url.replace(/\{[a-z]\}/g, "0")).host;
  assert(host === "tile.openstreetmap.org", `the tile host must be tile.openstreetmap.org, got ${host}`);
}

/** `F4.163` T2 — the tile layer carries the attribution the OpenStreetMap tile policy requires. */
export function runMapTileAttributionTest(): void {
  assert(
    MAP_TILE.attribution.includes("OpenStreetMap</a> contributors") &&
      MAP_TILE.attribution.includes("https://www.openstreetmap.org/copyright"),
    `the attribution must credit OpenStreetMap contributors with the copyright link, got ${MAP_TILE.attribution}`,
  );
}

/**
 * `F4.163` B1 — the map opens on the organization's own sites: when any pin
 * joins a location, only those pins decide the box, so a far unjoined station
 * pin does not stretch it.
 */
export function runSiteBoundsPrefersJoinedSitesTest(): void {
  const bounds = siteBounds([
    site({ canonicalLocationId: "00000000-0000-0000-0000-0000000000a1", latitude: 26.1, longitude: 89.2 }),
    site({ canonicalLocationId: "00000000-0000-0000-0000-0000000000a2", latitude: 26.9, longitude: 89.9 }),
    site({ canonicalLocationId: null, latitude: -29, longitude: 24.5 }),
  ]);
  assert(
    JSON.stringify(bounds) === JSON.stringify([[26.1, 89.2], [26.9, 89.9]]),
    `expected the box of the two joined sites, got ${JSON.stringify(bounds)}`,
  );
}

/** `F4.163` B2 — with no joined pin, every pin decides the box. */
export function runSiteBoundsFallsBackToAllSitesTest(): void {
  const bounds = siteBounds([site({ latitude: -30, longitude: 20 }), site({ latitude: -25, longitude: 31 })]);
  assert(
    JSON.stringify(bounds) === JSON.stringify([[-30, 20], [-25, 31]]),
    `expected the box of every pin, got ${JSON.stringify(bounds)}`,
  );
}

/** `F4.163` B3 — no pins, no box: the map keeps its default view. */
export function runSiteBoundsEmptyIsNullTest(): void {
  const bounds = siteBounds([]);
  assert(bounds === null, `expected null for no sites, got ${JSON.stringify(bounds)}`);
}
