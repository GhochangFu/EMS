import { expect } from "vitest";

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
