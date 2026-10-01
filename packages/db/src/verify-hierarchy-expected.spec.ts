import { expect } from "vitest";

import { eskomSeedAssetCatalog } from "./eskom-assets-seed";
import { eskomCanonicalLocationRows, eskomLocationCode, seedMapLocationRows } from "./eskom-locations-seed";
import { mapLocationRowsForInsert } from "./map-locations-seed";
import { loadPheCatalog, stationSlug } from "./phe-pilot-seed";
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

/** The pattern `cleanupLegacyPheRtuLocations` matched before owner ruling 13. */
const OLD_LEGACY_SLUG_PATTERN = /^phe-.+-(i|ii)$/;

/**
 * Twelve legacy per-RTU PHE slugs, one per edge RTU, each one the old pattern
 * matched, and none a station's slug (owner ruling 13, OQ1).
 *
 * Mutations: deriving from the station name gives six station slugs, which
 * the disjointness check rejects; dropping the station filter changes
 * nothing here (the display names never equal a station name), so the length
 * and the pattern are the claims that hold the derivation.
 */
export function assertTwelveLegacyPheSlugs(): void {
  const { legacyLocationSlugs } = hierarchyExpectations().phe;
  expect(legacyLocationSlugs, "one legacy slug per edge RTU").toHaveLength(12);
  expect(distinct(legacyLocationSlugs), "the legacy slugs must be distinct").toBe(12);
  expect(
    legacyLocationSlugs.filter((slug) => !OLD_LEGACY_SLUG_PATTERN.test(slug)),
    "every legacy slug is one the old pattern matched",
  ).toEqual([]);
  const stationSlugs = new Set(loadPheCatalog().rows.map((row) => stationSlug(row.StationName)));
  expect(stationSlugs.size, "the catalog carries six stations").toBe(6);
  expect(
    legacyLocationSlugs.filter((slug) => stationSlugs.has(slug)),
    "no legacy slug may be a station's slug, or the cleanup deletes a live station",
  ).toEqual([]);
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
  expect(() => hierarchyExpectations(empty)).toThrow(/phe\.locationCodes/);
  expect(() => hierarchyExpectations(empty)).toThrow(/phe\.legacyLocationSlugs/);
  let message = "";
  try {
    hierarchyExpectations(empty);
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

/** `F3.73` plan D12 — each of the six PHE catalog stations carries one, by its station slug. */
export function assertSixPheSiteLayoutSlugs(): void {
  const { siteLayoutPheSlugs } = hierarchyExpectations();
  const catalog = loadPheCatalog();
  expect(distinct(siteLayoutPheSlugs)).toBe(6);
  expect([...siteLayoutPheSlugs].sort()).toEqual(
    [...new Set(catalog.rows.map((row) => stationSlug(row.StationName)))].sort(),
  );
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
