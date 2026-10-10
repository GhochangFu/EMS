import type { MapSiteDto } from "@bms/shared";

import {
  controlRoomSiteLink,
  estateSiteLink,
  isOperationalSite,
  MAP_TILE,
  organizationNodes,
  organizationPins,
  siteBounds,
} from "./map-site";

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

/** A complete `MapSiteDto` for other specs (the org site map). */
export { site as mapSite };

const ORG_A = { id: "org-a", code: "ALPHA", name: "Alpha Utilities" };
const ORG_B = { id: "org-b", code: "BETA", name: "Beta Water" };

/**
 * `F3.79` O1 — the org site map keeps only this organization's pins. The pin of
 * this organization is the positive control for the two pins it drops: another
 * organization's, and a reference station with no organization.
 */
export function runOrganizationPinsKeepsOnlyThisOrganizationTest(): void {
  const pins = organizationPins(
    [
      site({ id: "a1", canonicalLocationId: "loc-a1", organization: ORG_A }),
      site({ id: "b1", canonicalLocationId: "loc-b1", organization: ORG_B }),
      site({ id: "st", canonicalLocationId: null, organization: null }),
      site({ id: "a2", canonicalLocationId: "loc-a2", organization: ORG_A }),
    ],
    ORG_A.id,
  );
  assert(
    JSON.stringify(pins.map((p) => p.id)) === JSON.stringify(["a1", "a2"]),
    `expected only org A's pins a1 and a2, got ${JSON.stringify(pins.map((p) => p.id))}`,
  );
}

/** `F3.79` O2 — an organization with no pin gets an empty list, not every pin. */
export function runOrganizationPinsEmptyForAnOrganizationWithNoPinTest(): void {
  const pins = organizationPins([site({ id: "b1", organization: ORG_B })], ORG_A.id);
  assert(pins.length === 0, `expected no pins for org A, got ${pins.length}`);
}

/**
 * `F3.79` L1 — the Sites map's popup link is unchanged: "Dashboard", to the
 * site's Assets & RTUs tab (`F3.72` OQ9), or `/` for a pin that joins no location.
 */
export function runEstateSiteLinkOpensTheAssetsTabTest(): void {
  const joined = estateSiteLink(site({ canonicalLocationId: "loc-1" }));
  assert(
    joined.label === "Dashboard" && joined.to === "/control-room/site/loc-1/assets",
    `expected Dashboard -> /control-room/site/loc-1/assets, got ${JSON.stringify(joined)}`,
  );
  const unjoined = estateSiteLink(site({ canonicalLocationId: null }));
  assert(unjoined.to === "/", `expected / for an unjoined pin, got ${unjoined.to}`);
}

/**
 * `F3.79` L2 — the org site map's popup link opens the next drill-down level:
 * the site's Control Room overview, not one of its tabs.
 */
export function runControlRoomSiteLinkOpensTheSiteLevelTest(): void {
  const link = controlRoomSiteLink(site({ canonicalLocationId: "loc-1" }));
  assert(
    link.label === "Open site" && link.to === "/control-room/site/loc-1",
    `expected Open site -> /control-room/site/loc-1, got ${JSON.stringify(link)}`,
  );
}

/**
 * `F2.10` (plan T7, O2) — the org site map's filter nodes are the scope's nodes that are KPI rows
 * of this organization (`GET /dashboard/locations` lists every active readable node). Org A's
 * node is the positive control for the one it drops.
 */
export function runOrganizationNodesKeepsOnlyThisOrganizationTest(): void {
  const nodes = [
    { id: "loc-a1", code: "A1", slug: "a1", name: "A1", type: "site", province: null, parentId: null },
    { id: "loc-b1", code: "B1", slug: "b1", name: "B1", type: "site", province: null, parentId: null },
  ];
  const kpis = [
    { id: "loc-a1", organization: ORG_A },
    { id: "loc-b1", organization: ORG_B },
  ];
  const kept = organizationNodes(nodes, kpis, ORG_A.id).map((n) => n.id);
  assert(
    JSON.stringify(kept) === JSON.stringify(["loc-a1"]),
    `expected only org A's node, got ${JSON.stringify(kept)}`,
  );
}
