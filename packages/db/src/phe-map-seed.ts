import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type PheCatalogRow = {
  StationId: number;
  StationCode: string;
  StationName: string;
  Latitude: number;
  Longitude: number;
};

type PheCatalogFile = {
  rows: PheCatalogRow[];
};

function stationSlug(stationName: string): string {
  return `phe-${stationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

/** Map marker rows for PHEWB pump-house stations. */
export function pheMapLocationRowsForInsert() {
  const raw = readFileSync(resolve(process.cwd(), "src/phe-catalog.json"), "utf8");
  const catalog = JSON.parse(raw) as PheCatalogFile;
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
      kind: "rsmoc" as const,
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
