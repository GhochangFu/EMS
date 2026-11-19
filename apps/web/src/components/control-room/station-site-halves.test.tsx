// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aGeneratedSiteMountsItsGeneratedView,
  aHalfWithoutTheKeyShowsItsEmptyState,
  anUnknownSegmentRedirectsOnceSettled,
  bothHalvesMountTheirOwnDashboard,
  cleanupHalves,
  eachHalfNamesAndLinksItsSite,
  theReadsNameTheSitesUnderTheSharedKeys,
  theSegmentChoosesBothHalvesTab,
} from "./station-site-halves.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock is
 * here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.240 part b StationSiteHalves (ADR 0140 decision 3e, plan D8, D9)", () => {
  afterEach(() => {
    cleanupHalves();
  });

  it("HV1 mounts each site's own dashboard, embedded, in list order, at the first tab", async () => {
    await bothHalvesMountTheirOwnDashboard();
  });

  it("HV2 the route segment chooses both halves' tab; the chooser marks it current", async () => {
    await theSegmentChoosesBothHalvesTab();
  });

  it("HV3 a half whose dashboard lacks the key shows its empty state and no dashboard", async () => {
    await aHalfWithoutTheKeyShowsItsEmptyState();
  });

  it("HV4 a generated site mounts its generated view for every tab", async () => {
    await aGeneratedSiteMountsItsGeneratedView();
  });

  it("HV5 an unknown segment redirects once every read has settled, never while one is pending", async () => {
    await anUnknownSegmentRedirectsOnceSettled();
  });

  it("HV6 each half names its site and links to its own page", async () => {
    await eachHalfNamesAndLinksItsSite();
  });

  it("HV7 the reads name the sites, never the station, under the site page's keys", async () => {
    await theReadsNameTheSitesUnderTheSharedKeys();
  });
});
