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
