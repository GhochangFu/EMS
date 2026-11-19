// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aLeafRendersTheSitePage,
  anUnreadableStationShowsTheNotAvailableCard,
  aRejectedStationResolveShowsTheNotAvailableCard,
  aParentThatHoldsAssetsRendersTheSitePage,
  aSitesStationCrumbIsALink,
  cleanupStation,
  otherSegmentsRedirectAndTheStripHasTwoEntries,
  theLowerCardsCarryTheStation,
  theRailReadsTheStationLocation,
  theStationAssetsListsEachSite,
  theStationHasNoWall,
  theStationPollsTheListAtSixtySeconds,
  theStationUrlRendersTheStation,
  theTotalsLineIsTheHeadersSentenceAndTheKw,
} from "./site-page-station.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.240 part b the site page at a station (ADR 0140)", () => {
  afterEach(() => {
    cleanupStation();
  });

  it("ST1 renders the station: heading, subtitle, crumbs and its two site cards", async () => {
    await theStationUrlRendersTheStation();
  });

  it("ST2 renders the site page for a leaf", async () => {
    await aLeafRendersTheSitePage();
  });

  it("ST3 renders the site page for a parent that holds assets", async () => {
    await aParentThatHoldsAssetsRendersTheSitePage();
  });

  it("ST4 reads the header's roll-up sentence and the sites' kW in the totals line", async () => {
    await theTotalsLineIsTheHeadersSentenceAndTheKw();
  });

  it("ST5 hands the rail the station's locationId", async () => {
    await theRailReadsTheStationLocation();
  });

  it("ST6 hands the advisory cards and the dashboards list the station", async () => {
    await theLowerCardsCarryTheStation();
  });

  it("ST7 lists each site on /assets, with no SiteAssetsView", async () => {
    await theStationAssetsListsEachSite();
  });

  it("ST8 redirects /trends and an unknown segment; the strip has two entries", async () => {
    await otherSegmentsRedirectAndTheStripHasTwoEntries();
  });

  it("ST9 draws no wall and no Wall link at a station", async () => {
    await theStationHasNoWall();
  });

  it("ST10 shows the not-available card for a station outside the list", async () => {
    await anUnreadableStationShowsTheNotAvailableCard();
  });

  it("ST10b shows the not-available card when the station's resolve is rejected", async () => {
    await aRejectedStationResolveShowsTheNotAvailableCard();
  });

  it("ST11 links a site's station crumb; no crumb with a null parent", async () => {
    await aSitesStationCrumbIsALink();
  });

  it("ST12 keeps the site page's 60 s list poll at a station (ruling Q2)", async () => {
    await theStationPollsTheListAtSixtySeconds();
  });
});
