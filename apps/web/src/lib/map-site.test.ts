import { describe, it } from "vitest";

import {
  runControlRoomSiteLinkOpensTheSiteLevelTest,
  runEstateSiteLinkOpensTheAssetsTabTest,
  runMapTileAttributionTest,
  runOrganizationNodesKeepsOnlyThisOrganizationTest,
  runOrganizationPinsEmptyForAnOrganizationWithNoPinTest,
  runOrganizationPinsKeepsOnlyThisOrganizationTest,
  runMapTileIsOpenStreetMapTest,
  runOperationalSiteJoinedPumpStationTest,
  runOperationalSiteUnjoinedRsmocTest,
  runSiteBoundsEmptyIsNullTest,
  runSiteBoundsFallsBackToAllSitesTest,
  runSiteBoundsPrefersJoinedSitesTest,
} from "./map-site.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("map-site", () => {
  it("treats a pin that joins a location as operational, whatever its type (F4.157 W1)", () => {
    runOperationalSiteJoinedPumpStationTest();
  });

  it("treats a pin that joins no location as not operational, even an rsmoc one (F4.157 W2)", () => {
    runOperationalSiteUnjoinedRsmocTest();
  });

  it("uses the standard OpenStreetMap tile layer, not the CARTO basemap (F4.163 T1)", () => {
    runMapTileIsOpenStreetMapTest();
  });

  it("credits OpenStreetMap contributors on the tile layer (F4.163 T2)", () => {
    runMapTileAttributionTest();
  });

  it("opens on the joined sites when there are any (F4.163 B1)", () => {
    runSiteBoundsPrefersJoinedSitesTest();
  });

  it("opens on every pin when none joins a location (F4.163 B2)", () => {
    runSiteBoundsFallsBackToAllSitesTest();
  });

  it("has no box for no sites (F4.163 B3)", () => {
    runSiteBoundsEmptyIsNullTest();
  });

  it("keeps only this organization's pins (F3.79 O1)", () => {
    runOrganizationPinsKeepsOnlyThisOrganizationTest();
  });

  it("keeps no pin for an organization with none (F3.79 O2)", () => {
    runOrganizationPinsEmptyForAnOrganizationWithNoPinTest();
  });

  it("links the Sites map popup to the site's Assets & RTUs tab (F3.79 L1)", () => {
    runEstateSiteLinkOpensTheAssetsTabTest();
  });

  it("links the org site map popup to the site's Control Room level (F3.79 L2)", () => {
    runControlRoomSiteLinkOpensTheSiteLevelTest();
  });

  it("keeps only this organization's scope nodes for the org map filter (F2.10 S1)", () => {
    runOrganizationNodesKeepsOnlyThisOrganizationTest();
  });
});
