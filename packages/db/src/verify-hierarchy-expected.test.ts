import { describe, it } from "vitest";

import {
  assertOneEskomSiteLayoutLocation,
  assertSeventyTwoSmocRoledAssets,
  assertSixPheSiteLayoutSlugs,
  assertAnEmptyDerivedListIsRefused,
  assertCombinedAndEskomOnlyRowsAgree,
  assertElevenEskomLocations,
  assertFortyEightPheAssets,
  assertFourteenEskomItAssets,
  assertNineEskomIncomers,
  assertSixPheLocations,
  assertThirtySixPheElectricalAssets,
  assertTsPointsAreDisjointFromThePoints,
  assertTwelvePheRtus,
  assertTwoHundredFiftyTwoPhePoints,
  assertTwelveLegacyPheSlugs,
  assertTwoSeedOrganizations,
} from "./verify-hierarchy-expected.spec";

describe("F4.169/F4.170 addendum — the boot gate's expectations derive from the seed catalogs", () => {
  it("derives the two seed organizations", () => {
    assertTwoSeedOrganizations();
  });

  it("derives eleven ESKOM locations, the decommissioned fixture once", () => {
    assertElevenEskomLocations();
  });

  it("derives nine ESKOM incomers by role", () => {
    assertNineEskomIncomers();
  });

  it("derives fourteen ESKOM IT assets", () => {
    assertFourteenEskomItAssets();
  });

  it("derives six PHE locations", () => {
    assertSixPheLocations();
  });

  it("derives twelve PHE RTUs", () => {
    assertTwelvePheRtus();
  });

  it("derives forty-eight PHE assets", () => {
    assertFortyEightPheAssets();
  });

  it("derives 252 PHE points, without TS", () => {
    assertTwoHundredFiftyTwoPhePoints();
  });

  it("keeps the TS pairs non-empty and disjoint from the points", () => {
    assertTsPointsAreDisjointFromThePoints();
  });

  it("derives thirty-six PHE electrical assets", () => {
    assertThirtySixPheElectricalAssets();
  });

  it("derives twelve legacy per-RTU PHE slugs, none a station's", () => {
    assertTwelveLegacyPheSlugs();
  });

  it("gives the same ESKOM codes and asset catalog from the combined and the ESKOM-only map rows", () => {
    assertCombinedAndEskomOnlyRowsAgree();
  });

  it("refuses an empty derived list, naming it", () => {
    assertAnEmptyDerivedListIsRefused();
  });

  it("F3.73 derives one ESKOM site-layout location, CSMOC Gauteng, not RSMOC-WC", () => {
    assertOneEskomSiteLayoutLocation();
  });

  it("F3.73 derives six PHE site-layout station slugs", () => {
    assertSixPheSiteLayoutSlugs();
  });

  it("F3.73 derives seventy-two SMOC-roled ESKOM assets", () => {
    assertSeventyTwoSmocRoledAssets();
  });
});
