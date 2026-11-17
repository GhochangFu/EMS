// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupWall,
  noWallLinkOnAGeneratedView,
  theNormalPageDoesNotPassWall,
  theWallBranchPassesWall,
  theWallLinkAtTheBarePath,
  theWallLinkCarriesTheTabAndTheDefaults,
  theWallRotatesByTheDashboardsTabOrder,
  wallOnADashboardViewRendersTheFrame,
  wallOnAGeneratedViewRendersTheNormalPage,
  wallOnTheAssetsTabRendersTheNormalPage,
  wallOnTheTrendsSectionRendersTheNormalPage,
  theWallLinkOmitsTheTrendsSegment,
  thePageHandsTheSitesEnergyShown,
  aSiteDashboardDrawsMlFindingsOffTheWallOnly,
} from "./site-page-wall.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.77 the site page's wall mode (plan D8)", () => {
  afterEach(() => {
    cleanupWall();
  });

  it("P1 renders the wall frame and not the shell for wall=1 on a dashboard view", async () => {
    await wallOnADashboardViewRendersTheFrame();
  });

  it("P2 renders the normal page for wall=1 on a generated view", async () => {
    await wallOnAGeneratedViewRendersTheNormalPage();
  });

  it("P3 renders the normal page for wall=1 on the assets tab", async () => {
    await wallOnTheAssetsTabRendersTheNormalPage();
  });

  it("P4 shows a Wall link with the tab and wall=1&every=30 on a dashboard view", async () => {
    await theWallLinkCarriesTheTabAndTheDefaults();
  });

  it("P5 shows the Wall link on the bare path with the defaults", async () => {
    await theWallLinkAtTheBarePath();
  });

  it("P6 shows no Wall link on a generated view", async () => {
    await noWallLinkOnAGeneratedView();
  });

  it("P7 rotates through the dashboard's tabs by sortOrder", async () => {
    await theWallRotatesByTheDashboardsTabOrder();
  });

  it("P8 hands the site's dashboard view wall in the wall branch", async () => {
    await theWallBranchPassesWall();
  });

  it("P9 does not hand the view wall on the normal page", async () => {
    await theNormalPageDoesNotPassWall();
  });

  it("P10 renders the normal page for wall=1 on the Trends & Energy section", async () => {
    await wallOnTheTrendsSectionRendersTheNormalPage();
  });

  it("P11 omits the trends segment from the Wall link", async () => {
    await theWallLinkOmitsTheTrendsSegment();
  });
});

describe("F4.375 — the site page hands energyShown to the site layout (ADR 0133 Amendment 2)", () => {
  afterEach(() => {
    cleanupWall();
  });

  it("P10 the wall hands energyShown false", async () => {
    await thePageHandsTheSitesEnergyShown(true, false);
  });

  it("P10 the wall hands energyShown true", async () => {
    await thePageHandsTheSitesEnergyShown(true, true);
  });

  it("P10 the page body hands energyShown false", async () => {
    await thePageHandsTheSitesEnergyShown(false, false);
  });

  it("P10 the page body hands energyShown true", async () => {
    await thePageHandsTheSitesEnergyShown(false, true);
  });
});

describe("E1.9f — the ml_findings widget is not on the wall (ADR 0135 Amendment 8 decision 13, Q4)", () => {
  afterEach(() => {
    cleanupWall();
  });

  it("P12 a site dashboard does not draw its ml_findings widget on the wall", async () => {
    await aSiteDashboardDrawsMlFindingsOffTheWallOnly(true);
  });

  it("P12 a site dashboard draws its ml_findings widget off the wall", async () => {
    await aSiteDashboardDrawsMlFindingsOffTheWallOnly(false);
  });
});
