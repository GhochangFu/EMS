// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aDashboardSiteRendersTheSection,
  aGeneratedSiteRendersTheSectionUnredirected,
  aRejectedReadShowsTheCardAndNoSection,
  atTheBarePathSiteViewIsCurrent,
  cleanupTrends,
  theSmocSiteRendersTheSection,
  theStripHasThreeEntriesWithTrendsCurrent,
  aNoEnergySiteNamesTheThirdEntryTrends,
  theSectionGetsTheSitesEnergyShown,
} from "./site-page-trends.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.302 the site page's Trends & Energy section", () => {
  afterEach(() => {
    cleanupTrends();
  });

  it("T1 lists three sections with Trends & Energy current at /trends", async () => {
    await theStripHasThreeEntriesWithTrendsCurrent();
  });

  it("T2 keeps Site view current at the bare path", async () => {
    await atTheBarePathSiteViewIsCurrent();
  });

  it("T3 renders the section unredirected on a generated site", async () => {
    await aGeneratedSiteRendersTheSectionUnredirected();
  });

  it("T4 renders the section on a dashboard site", async () => {
    await aDashboardSiteRendersTheSection();
  });

  it("T5 renders the section on the SMOC site", async () => {
    await theSmocSiteRendersTheSection();
  });

  it("T6 shows the not-available card and no section for a rejected resolve read", async () => {
    await aRejectedReadShowsTheCardAndNoSection();
  });

  it("F4.364 T7: a no-energy site names its third entry Trends", async () => {
    await aNoEnergySiteNamesTheThirdEntryTrends();
  });

  it("F4.364 T8: the section gets the site's energyShown", async () => {
    await theSectionGetsTheSitesEnergyShown();
  });
});
