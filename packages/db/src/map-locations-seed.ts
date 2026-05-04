/**
 * Derived from `ESKOM_SMOC.html` `ESKOM_STATIONS` (prototype Sprint 5).
 * Fields: nm→name, mw→capacityMw, tp→stationType, cat→stationCategory, st→stationOperatingStatus.
 */
export const eskomStationsSeed = [
  { nm: "Arnot", mw: 2352, tp: "coal", cat: "Base Load", st: "op", lat: -25.95, lng: 29.79, prov: "Mpumalanga" },
  { nm: "Duvha", mw: 3600, tp: "coal", cat: "Base Load", st: "op", lat: -25.97, lng: 29.34, prov: "Mpumalanga" },
  { nm: "Hendrina", mw: 1893, tp: "coal", cat: "Base Load", st: "op", lat: -26.03, lng: 29.59, prov: "Mpumalanga" },
  { nm: "Kendal", mw: 4116, tp: "coal", cat: "Base Load", st: "op", lat: -26.08, lng: 28.97, prov: "Mpumalanga" },
  { nm: "Kriel", mw: 3000, tp: "coal", cat: "Base Load", st: "op", lat: -26.25, lng: 29.18, prov: "Mpumalanga" },
  { nm: "Lethabo", mw: 3708, tp: "coal", cat: "Base Load", st: "op", lat: -26.74, lng: 27.97, prov: "Free State" },
  { nm: "Majuba", mw: 4110, tp: "coal", cat: "Base Load", st: "op", lat: -27.1, lng: 29.77, prov: "Mpumalanga" },
  { nm: "Matla", mw: 3600, tp: "coal", cat: "Base Load", st: "op", lat: -26.28, lng: 29.13, prov: "Mpumalanga" },
  { nm: "Tutuka", mw: 3654, tp: "coal", cat: "Base Load", st: "op", lat: -26.78, lng: 29.35, prov: "Mpumalanga" },
  { nm: "Koeberg", mw: 1940, tp: "nuc", cat: "Base Load", st: "op", lat: -33.68, lng: 18.43, prov: "Western Cape" },
  { nm: "Camden", mw: 1510, tp: "rts", cat: "Return to Service", st: "op", lat: -26.62, lng: 30.1, prov: "Mpumalanga" },
  { nm: "Grootvlei", mw: 1200, tp: "rts", cat: "Return to Service", st: "op", lat: -26.78, lng: 28.51, prov: "Mpumalanga" },
  { nm: "Komati", mw: 990, tp: "rts", cat: "Return to Service", st: "op", lat: -26.09, lng: 29.62, prov: "Mpumalanga" },
  { nm: "Gariep", mw: 360, tp: "hyd", cat: "Peak Demand", st: "op", lat: -30.62, lng: 25.5, prov: "Free State" },
  { nm: "Vanderkloof", mw: 240, tp: "hyd", cat: "Peak Demand", st: "op", lat: -29.99, lng: 24.73, prov: "Northern Cape" },
  { nm: "Drakensberg", mw: 1000, tp: "pum", cat: "Peak Demand", st: "op", lat: -28.74, lng: 29.05, prov: "Free State" },
  { nm: "Palmiet", mw: 400, tp: "pum", cat: "Peak Demand", st: "op", lat: -34.27, lng: 18.97, prov: "Western Cape" },
  { nm: "Acacia", mw: 171, tp: "gas", cat: "Peak Demand", st: "op", lat: -33.83, lng: 18.52, prov: "Western Cape" },
  { nm: "Port Rex", mw: 171, tp: "gas", cat: "Peak Demand", st: "op", lat: -33.02, lng: 27.91, prov: "Eastern Cape" },
  { nm: "Ankerlig", mw: 1338, tp: "gas", cat: "Peak Demand", st: "op", lat: -33.65, lng: 18.58, prov: "Western Cape" },
  { nm: "Gourikwa", mw: 746, tp: "gas", cat: "Peak Demand", st: "op", lat: -34.05, lng: 22.1, prov: "Western Cape" },
  { nm: "Klipheuwel Wind", mw: 3, tp: "wind", cat: "Renewable", st: "op", lat: -33.55, lng: 18.72, prov: "Western Cape" },
  { nm: "Medupi", mw: 4788, tp: "coal", cat: "New Build", st: "op", lat: -23.71, lng: 27.59, prov: "Limpopo" },
  { nm: "Kusile", mw: 4800, tp: "coal", cat: "New Build", st: "op", lat: -26.08, lng: 28.95, prov: "Mpumalanga" },
  { nm: "Ingula", mw: 1332, tp: "pum", cat: "New Build", st: "op", lat: -28.27, lng: 29.55, prov: "KZN/Free State" },
  { nm: "Sere Wind", mw: 100, tp: "wind", cat: "New Build", st: "op", lat: -32.68, lng: 18.34, prov: "Western Cape" },
  { nm: "CSP Solar", mw: 100, tp: "sol", cat: "New Build", st: "op", lat: -30.67, lng: 22.1, prov: "Northern Cape" },
  { nm: "First Falls", mw: 6, tp: "hyd", cat: "Distribution", st: "op", lat: -32.55, lng: 28.13, prov: "Eastern Cape" },
  { nm: "Second Falls", mw: 11, tp: "hyd", cat: "Distribution", st: "op", lat: -32.6, lng: 28.2, prov: "Eastern Cape" },
  { nm: "Colley Wobbles", mw: 42, tp: "hyd", cat: "Distribution", st: "op", lat: -32.05, lng: 28.35, prov: "Eastern Cape" },
  { nm: "Ncora", mw: 2, tp: "hyd", cat: "Distribution", st: "op", lat: -31.85, lng: 27.8, prov: "Eastern Cape" },
] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type SmocCampusSeed = {
  slug: string;
  name: string;
  siteName: string;
  lat: number;
  lng: number;
};

export const smocCampusesSeed: readonly SmocCampusSeed[] = [];

/** RSMOC / CSMOC locations supplied for the location-access planning sprint. */
export const operationalLocationsSeed = [
  {
    type: "RSMOC",
    province: "Eastern Cape",
    capital: "Bhisho",
    lat: -32.8476,
    lng: 27.4422,
  },
  {
    type: "RSMOC",
    province: "Free State",
    capital: "Bloemfontein",
    lat: -29.0852,
    lng: 26.1596,
  },
  {
    type: "RSMOC",
    province: "Gauteng",
    capital: "Johannesburg",
    lat: -26.2041,
    lng: 28.0473,
  },
  {
    type: "RSMOC",
    province: "KwaZulu-Natal",
    capital: "Pietermaritzburg",
    lat: -29.6006,
    lng: 30.3794,
  },
  {
    type: "RSMOC",
    province: "Limpopo",
    capital: "Polokwane",
    lat: -23.9045,
    lng: 29.4689,
  },
  {
    type: "RSMOC",
    province: "Mpumalanga",
    capital: "Mbombela",
    lat: -25.4658,
    lng: 30.9853,
  },
  {
    type: "RSMOC",
    province: "North West",
    capital: "Mahikeng",
    lat: -25.8652,
    lng: 25.6442,
  },
  {
    type: "RSMOC",
    province: "Northern Cape",
    capital: "Kimberley",
    lat: -28.7282,
    lng: 24.7499,
  },
  {
    type: "RSMOC",
    province: "Western Cape",
    capital: "Cape Town",
    lat: -33.9249,
    lng: 18.4241,
  },
  {
    type: "CSMOC",
    province: "Gauteng",
    capital: "Johannesburg",
    lat: -26.2041,
    lng: 28.0473,
  },
] as const;

export function mapLocationRowsForInsert() {
  const stations = eskomStationsSeed.map((s) => ({
    slug: slugify(s.nm),
    name: s.nm,
    kind: "eskom_station" as const,
    siteName: null as string | null,
    latitude: s.lat,
    longitude: s.lng,
    capacityMw: s.mw,
    stationType: s.tp,
    stationCategory: s.cat,
    province: s.prov,
    stationOperatingStatus: s.st,
    meta: { source: "ESKOM_SMOC.html" },
  }));

  const campuses = smocCampusesSeed.map((c) => ({
    slug: c.slug,
    name: c.name,
    kind: "smoc_campus" as const,
    siteName: c.siteName,
    latitude: c.lat,
    longitude: c.lng,
    capacityMw: null as number | null,
    stationType: null as string | null,
    stationCategory: null as string | null,
    province: null as string | null,
    stationOperatingStatus: null as string | null,
    meta: { source: "seed" },
  }));

  const operationalLocations = operationalLocationsSeed.map((c) => {
    const type = c.type.toLowerCase();
    const name = `${c.type} ${c.province}`;
    return {
      slug: `${type}-${slugify(c.province)}`,
      name,
      kind: type as "rsmoc" | "csmoc",
      siteName: name,
      latitude: c.lat,
      longitude: c.lng,
      capacityMw: null as number | null,
      stationType: null as string | null,
      stationCategory: c.type,
      province: c.province,
      stationOperatingStatus: null as string | null,
      meta: {
        source: "attached-location-dataset",
        type: c.type,
        capital: c.capital,
      },
    };
  });

  return [...stations, ...campuses, ...operationalLocations];
}
