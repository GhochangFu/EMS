import { expect } from "vitest";

import { eskomSeedAssetCatalog } from "./eskom-assets-seed";
import { eskomCanonicalLocationRows, eskomLocationCode, seedMapLocationRows } from "./eskom-locations-seed";
import { mapLocationRowsForInsert } from "./map-locations-seed";
import { loadPheCatalog, pheRtuSites, stationSlug } from "./phe-pilot-seed";
import { PHE_SPLIT_STATION_CODES } from "./phe-split-stations";
import { hierarchyExpectations } from "./verify-hierarchy-expected";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.169` / `F4.170` addendum — the boot gate's wanted numbers are the
 * lengths of lists derived from the seed's catalogs, so a derivation that
 * drifts moves the gate silently. These pin each derivation to the number the
 * gate asserted as a literal before the addendum, so a derivation that reads
 * the wrong field, the wrong domain or the wrong role reddens here, not at the
 * next boot.
 *
 * Every list must also be free of duplicates: the gate counts rows whose code
 * is `= ANY(list)`, which counts a row once however often its code repeats,
 * so a duplicate would raise the wanted number and fail every boot.
 */

function distinct<T>(values: readonly T[]): number {
  return new Set(values).size;
}

/** Two seed organizations, ESKOM and PHEWB, with no duplicate. */
export function assertTwoSeedOrganizations(): void {
  const { organizationCodes } = hierarchyExpectations();
  expect(organizationCodes, "the seed writes ESKOM and PHEWB").toEqual(["ESKOM", "PHEWB"]);
}

/**
 * Eleven ESKOM locations: ten canonical and the `F4.10` fixture.
 *
 * Mutation: dropping `DECOMMISSIONED_LOCATION_CODE` from the list gives 10.
 */
export function assertElevenEskomLocations(): void {
  const { eskomLocationCodes, decommissionedLocationCode } = hierarchyExpectations();
  expect(eskomLocationCodes, "10 canonical ESKOM locations plus ESK-DECOMM-01").toHaveLength(11);
  expect(distinct(eskomLocationCodes), "the ESKOM location codes must be distinct").toBe(11);
  expect(eskomLocationCodes.filter((code) => code === decommissionedLocationCode)).toHaveLength(1);
}

/**
 * Nine ESKOM incomers: one per RSMOC site plus the control room's.
 *
 * Mutation: deriving by domain (`electrical`) rather than by role gives far
 * more than nine.
 */
export function assertNineEskomIncomers(): void {
  const { eskomIncomerCodes } = hierarchyExpectations();
  expect(eskomIncomerCodes, "nine incoming-supply assets in the ESKOM catalog").toHaveLength(9);
  expect(distinct(eskomIncomerCodes)).toBe(9);
}

/**
 * Fourteen ESKOM IT assets: one at each of eight RSMOC sites, six at Western
 * Cape.
 *
 * Mutation: omitting the Western Cape control-room IT assets gives 8.
 */
export function assertFourteenEskomItAssets(): void {
  const { eskomItCodes } = hierarchyExpectations();
  expect(eskomItCodes, "fourteen IT assets in the ESKOM catalog").toHaveLength(14);
  expect(distinct(eskomItCodes)).toBe(14);
}

/** Six PHEWB station locations. Mutation: deriving from `StationName` gives other codes. */
export function assertSixPheLocations(): void {
  const { locationCodes } = hierarchyExpectations().phe;
  expect(locationCodes, "six PHE stations").toHaveLength(6);
  expect(locationCodes.every((code) => code.startsWith("PHE-")), "every PHE location code starts PHE-").toBe(true);
}

/** Twelve PHEWB RTUs. Mutation: deriving one per station gives 6. */
export function assertTwelvePheRtus(): void {
  const { externalRtuIds } = hierarchyExpectations().phe;
  expect(externalRtuIds, "twelve PHE edge RTUs").toHaveLength(12);
  expect(distinct(externalRtuIds)).toBe(12);
}

/** Forty-eight PHE assets. Mutation: deriving one per RTU gives 12. */
export function assertFortyEightPheAssets(): void {
  const { assetCodes } = hierarchyExpectations().phe;
  expect(assetCodes, "forty-eight PHE devices").toHaveLength(48);
  expect(distinct(assetCodes)).toBe(48);
}

/** 252 PHE points: every sensor but `TS`. Mutation: keeping `TS` gives 264. */
export function assertTwoHundredFiftyTwoPhePoints(): void {
  const { points } = hierarchyExpectations().phe;
  expect(points, "252 catalogued PHE points").toHaveLength(252);
  expect(distinct(points.map((point) => `${point.assetCode}|${point.pointKey}`))).toBe(252);
}

/** The `TS` pairs are not empty and share no pair with the catalogued points. */
export function assertTsPointsAreDisjointFromThePoints(): void {
  const { points, tsPoints } = hierarchyExpectations().phe;
  expect(tsPoints.length, "the PHE catalog carries TS sensors").toBeGreaterThan(0);
  const catalogued = new Set(points.map((point) => `${point.assetCode}|${point.pointKey}`));
  expect(
    tsPoints.filter((point) => catalogued.has(`${point.assetCode}|${point.pointKey}`)),
    "no TS pair may also be a catalogued point",
  ).toEqual([]);
}

/** Thirty-six PHE electrical assets. Mutation: inverting the domain gives 12. */
export function assertThirtySixPheElectricalAssets(): void {
  const { electricalAssetCodes } = hierarchyExpectations().phe;
  expect(electricalAssetCodes, "36 PHE electrical devices (MFM, PUMP-M, PUMP-C)").toHaveLength(36);
  expect(distinct(electricalAssetCodes)).toBe(36);
}

/**
 * ADR 0139 decision 8 and plan D3/D9 — twelve RTU sites, one per edge RTU:
 * distinct slugs and codes, none a station's slug, each carrying its
 * station's slug and code and its own `EdgeRTUId`. The boot gate's shape
 * check reads this list, so a site that took a station's slug would make the
 * gate judge a live station.
 *
 * Mutations: deriving the slug from the station name gives six slugs, which
 * the length, the distinctness and the disjointness checks reject; taking the
 * first word as the suffix collides `PHE-CBLTPT1-LOTAPATA` twice.
 */
export function assertTwelvePheRtuSites(): void {
  const { rtuSites } = hierarchyExpectations().phe;
  const catalog = loadPheCatalog();
  expect(rtuSites, "one RTU site per edge RTU").toHaveLength(12);
  expect(distinct(rtuSites.map((site) => site.slug)), "the site slugs must be distinct").toBe(12);
  expect(distinct(rtuSites.map((site) => site.code)), "the site codes must be distinct").toBe(12);
  expect(distinct(rtuSites.map((site) => site.edgeRtuId)), "one site per edge RTU id").toBe(12);
  const stationSlugs = new Set(catalog.rows.map((row) => stationSlug(row.StationName)));
  expect(stationSlugs.size, "the catalog carries six stations").toBe(6);
  expect(
    rtuSites.filter((site) => stationSlugs.has(site.slug)),
    "no site slug may be a station's slug",
  ).toEqual([]);
  for (const site of rtuSites) {
    const head = catalog.rows.find((row) => row.EdgeRTUId === site.edgeRtuId);
    expect(head, `edge RTU ${site.edgeRtuId} is in the catalog`).toBeDefined();
    expect(site.name).toBe(head?.RTUDisplayName);
    expect(site.slug).toBe(stationSlug(head?.RTUDisplayName ?? ""));
    expect(site.stationSlug, `${site.slug} carries its station's slug`).toBe(stationSlug(head?.StationName ?? ""));
    expect(site.stationCode, `${site.slug} carries its station's code`).toBe(head?.StationCode);
    expect(site.latitude).toBe(Number(head?.Latitude));
    expect(site.longitude).toBe(Number(head?.Longitude));
  }
  const lotapata = rtuSites.filter((site) => site.stationCode === "CBLTPT1");
  expect(lotapata.map((site) => [site.slug, site.code])).toEqual([
    ["phe-lotapata-i", "PHE-CBLTPT1-I"],
    ["phe-lotapata-ii", "PHE-CBLTPT1-II"],
  ]);
}

/**
 * Plan D3 — a site identity the seed cannot write is refused, not guessed: a
 * display name whose last word is not `[A-Z0-9]+` once upper-cased, two RTUs
 * whose names give one slug or one code, and a site slug that is a station's
 * slug (the boot gate's shape check would count the live station).
 *
 * Mutations: dropping any one throw returns the bad entries. The slug throw
 * is held by two rows of one display name at different station codes, whose
 * codes differ; the code throw by `Lota-pata I`, whose slug differs.
 */
export function assertABadRtuSiteIdentityIsRefused(): void {
  const catalog = loadPheCatalog();
  const head = catalog.rows[0];
  if (!head) throw new Error("the PHE catalog has no rows");
  const withNames = (...names: string[]) => ({
    ...catalog,
    rows: names.map((name, index) => ({ ...head, EdgeRTUId: 9000 + index, RTUDisplayName: name })),
  });
  expect(() => pheRtuSites(withNames("Lotapata I-A"))).toThrow(/Lotapata I-A/);
  expect(() => pheRtuSites(withNames("Lotapata I", "Lotapata  I"))).toThrow(/duplicate site slug/);
  expect(() => pheRtuSites(withNames("Lotapata I", "Lota-pata I"))).toThrow(/duplicate site code/);
  const twoStations = withNames("Lotapata I", "Lotapata I");
  const [first, second] = twoStations.rows;
  if (!first || !second) throw new Error("withNames gave fewer than two rows");
  expect(() =>
    pheRtuSites({ ...twoStations, rows: [first, { ...second, StationCode: `${head.StationCode}X` }] }),
  ).toThrow(/duplicate site slug/);
  expect(() => pheRtuSites(withNames(head.StationName))).toThrow(
    new RegExp(`${stationSlug(head.StationName)}, which is a station's slug`),
  );
  expect(pheRtuSites(withNames("Lotapata I", "Lotapata II")).map((site) => site.code)).toEqual([
    `PHE-${head.StationCode}-I`,
    `PHE-${head.StationCode}-II`,
  ]);
}

/**
 * The combined ESKOM + PHE map rows `seed.ts` seeds from and the ESKOM rows
 * alone give the same canonical location codes and the same asset catalog:
 * no PHE map row is a campus or centre kind. `eskomSeedAssetCatalog`'s
 * default argument (the ESKOM rows alone) rests on this.
 *
 * Mutation: a PHE map row of kind `rsmoc` in a South African province adds
 * demo assets to the combined side only. The kind alone does not: the PHEWB
 * filter keeps the row out of the canonical locations, and West Bengal has
 * no demo assets.
 */
export function assertCombinedAndEskomOnlyRowsAgree(): void {
  const combined = seedMapLocationRows();
  const eskomOnly = mapLocationRowsForInsert();
  expect(combined.length, "the combined list carries the PHE rows too").toBeGreaterThan(eskomOnly.length);
  expect(eskomCanonicalLocationRows(combined).map(eskomLocationCode)).toEqual(
    eskomCanonicalLocationRows(eskomOnly).map(eskomLocationCode),
  );
  expect(eskomSeedAssetCatalog(combined)).toEqual(eskomSeedAssetCatalog(eskomOnly));
}

/**
 * An empty derived list stops the derivation, naming the list: a presence
 * count over it would want 0 and pass on any database.
 *
 * Mutation: removing the throw returns lists of length 0, and the gate's
 * wanted numbers read 0.
 */
export function assertAnEmptyDerivedListIsRefused(): void {
  const empty = { ...loadPheCatalog(), rows: [] };
  // The split list is passed as `[]`, not left to its default: this case is about empty derived
  // lists, and a committed list (release B) would otherwise throw first, naming a code the empty
  // catalog does not hold.
  expect(() => hierarchyExpectations(empty, [])).toThrow(/phe\.locationCodes/);
  expect(() => hierarchyExpectations(empty, [])).toThrow(/phe\.rtuSites/);
  let message = "";
  try {
    hierarchyExpectations(empty, []);
  } catch (err: unknown) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message, "only the empty lists are named").not.toContain("eskomLocationCodes");
}

/**
 * `F3.73` plan D12 — one ESKOM location carries a seeded site-layout copy: CSMOC Gauteng.
 * RSMOC-WC keeps its `builtin` view and is not in the list.
 */
export function assertOneEskomSiteLayoutLocation(): void {
  const { siteLayoutEskomLocations, controlRoomViewLocation } = hierarchyExpectations();
  expect(siteLayoutEskomLocations.map((identity) => identity.key)).toEqual(["csmoc-gauteng"]);
  expect(siteLayoutEskomLocations.map((identity) => identity.code)).toEqual(["CSMOC-GP"]);
  expect(siteLayoutEskomLocations.map((identity) => identity.key)).not.toContain(controlRoomViewLocation.key);
}

/**
 * `F3.73` plan D12 — each of the six PHE catalog stations carries one, by its station slug. The
 * list is passed as `[]`: the split sites a committed list adds are L6's case below.
 */
export function assertSixPheSiteLayoutSlugs(): void {
  const { siteLayoutPheSlugs } = hierarchyExpectations(loadPheCatalog(), []);
  const catalog = loadPheCatalog();
  expect(distinct(siteLayoutPheSlugs)).toBe(6);
  expect([...siteLayoutPheSlugs].sort()).toEqual(
    [...new Set(catalog.rows.map((row) => stationSlug(row.StationName)))].sort(),
  );
}

/**
 * `F4.388` L6 (ADR 0139 decision 6, plan D9) — a split station keeps its slug on the list (its
 * view row becomes `generated`, decision 7) and each of its sites adds one: six for an empty list,
 * eight with Lotapata on it. The default is the committed list.
 */
export function assertSiteLayoutPheSlugsGainTheSplitSites(): void {
  const catalog = loadPheCatalog();
  const stations = [...new Set(catalog.rows.map((row) => stationSlug(row.StationName)))];
  const none = hierarchyExpectations(catalog, []).siteLayoutPheSlugs;
  expect(none).toHaveLength(6);
  expect([...none].sort()).toEqual([...stations].sort());
  const lotapata = hierarchyExpectations(catalog, ["CBLTPT1"]).siteLayoutPheSlugs;
  expect(lotapata).toHaveLength(8);
  expect(distinct(lotapata)).toBe(8);
  expect([...lotapata].sort()).toEqual([...stations, "phe-lotapata-i", "phe-lotapata-ii"].sort());
  expect([...hierarchyExpectations().siteLayoutPheSlugs].sort(), "the default is the committed list").toEqual(
    [...hierarchyExpectations(catalog, PHE_SPLIT_STATION_CODES).siteLayoutPheSlugs].sort(),
  );
}

/** `F4.317` ruling Q3 — both seed organizations carry a seeded organization layout pointer row. */
export function assertTwoOrganizationLayoutOrganizations(): void {
  const { organizationLayoutOrganizationCodes } = hierarchyExpectations();
  expect([...organizationLayoutOrganizationCodes].sort()).toEqual(["ESKOM", "PHEWB"]);
}

/**
 * `F3.73` plan D12 — 72 catalog assets take a SMOC role: at Western Cape 5 UPS/battery, 2 HVAC,
 * 6 room sensors, 4 leak, 4 smoke and 6 IT; at each of the eight regional RSMOCs 5 (UPS-1,
 * BATT-1, HVAC-1, ENV-ROOM, NET-RACK); at CSMOC Gauteng `UPS-A` and `CH-CRAC-101..104`.
 *
 * Mutation: dropping the `indoor-air` branch of `demoRoleForAsset` gives 58.
 */
export function assertSeventyTwoSmocRoledAssets(): void {
  const { eskomSmocRoledCodes } = hierarchyExpectations();
  expect(eskomSmocRoledCodes).toHaveLength(72);
  expect(distinct(eskomSmocRoledCodes)).toBe(72);
}
