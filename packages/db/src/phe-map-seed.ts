import { loadPheCatalog, type PheCatalogFile, stationSlug } from "./phe-pilot-seed";
import type { PheResolvedSite } from "./phe-site-split";

/**
 * Map marker rows for PHEWB pump-house stations.
 *
 * The catalog and the station slug come from `phe-pilot-seed.ts`, so this file
 * and the seed that writes `bms.locations` cannot disagree on either. It used to
 * keep its own copies, and read the file from `process.cwd()` alone, which
 * worked only with `packages/db` as the working directory; `loadPheCatalog`
 * tries both candidates. `seed.ts` passes the catalog it has already read.
 */
export function pheMapLocationRowsForInsert(catalog: PheCatalogFile = loadPheCatalog()) {
  const stationIds = [...new Set(catalog.rows.map((r) => r.StationId))];

  return stationIds.map((stationId) => {
    const head = catalog.rows.find((r) => r.StationId === stationId);
    if (!head) {
      throw new Error(`Missing station head for id ${stationId}`);
    }
    const name = head.StationName;
    return {
      slug: stationSlug(name),
      name,
      kind: "pump_station" as const,
      siteName: name,
      latitude: Number(head.Latitude),
      longitude: Number(head.Longitude),
      capacityMw: null as number | null,
      stationType: null as string | null,
      stationCategory: "PHEWB",
      province: "West Bengal",
      stationOperatingStatus: null as string | null,
      meta: {
        source: "phe-catalog",
        organizationCode: "PHEWB",
        stationCode: head.StationCode,
        stationId,
      },
    };
  });
}

/**
 * `F4.388` (ADR 0139 decision 9, plan D8) — one map row per site `seedPheCatalog` resolved this run
 * (`PheSeedOutcome.sites`), never per listed site: a site it skipped is held by another location,
 * and the map joins a row to a location by slug alone, so a row for it would pin that location.
 * `seed.ts` inserts these inside PHEWB's first bracket, right after `seedPheCatalog`, with
 * `seedMapLocations` (insert if the slug is absent). The station's own row is not touched;
 * `PIN_RULE` hides it once its sites are active. Pure.
 */
export function pheSiteMapLocationRows(sites: readonly PheResolvedSite[], catalog: PheCatalogFile) {
  return sites.map((site) => {
    const head = catalog.rows.find((row) => row.EdgeRTUId === site.edgeRtuId);
    if (!head) {
      throw new Error(`pheSiteMapLocationRows: no catalog row for edge RTU ${site.edgeRtuId} (${site.slug})`);
    }
    return {
      slug: site.slug,
      name: site.name,
      kind: "pump_station" as const,
      siteName: site.locationName,
      latitude: site.latitude,
      longitude: site.longitude,
      capacityMw: null as number | null,
      stationType: null as string | null,
      stationCategory: "PHEWB",
      province: "West Bengal",
      stationOperatingStatus: null as string | null,
      meta: {
        source: "phe-catalog",
        organizationCode: "PHEWB",
        stationCode: site.stationCode,
        stationId: head.StationId,
        edgeRtuId: site.edgeRtuId,
      },
    };
  });
}
