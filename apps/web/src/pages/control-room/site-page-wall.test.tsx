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
});
