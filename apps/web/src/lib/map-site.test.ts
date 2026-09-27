import { describe, it } from "vitest";

import {
  runMapTileAttributionTest,
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
});
