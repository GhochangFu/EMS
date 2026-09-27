import type { MapSiteDto } from "@bms/shared";

import { isOperationalSite } from "./map-site";

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
