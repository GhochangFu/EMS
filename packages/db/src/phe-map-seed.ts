import { loadPheCatalog, type PheCatalogFile, stationSlug } from "./phe-pilot-seed";

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
