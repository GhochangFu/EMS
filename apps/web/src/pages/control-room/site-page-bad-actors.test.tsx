// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aDashboardViewOffTheWallDrawsTheCard,
  aPendingSiteViewDrawsNoCard,
  cleanupBadActors,
  theAssetsTabDrawsNoCard,
  theBodyDrawsTheCardForTheSite,
  theTrendsTabDrawsNoCard,
  theWallDrawsNoCard,
} from "./site-page-bad-actors.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("E1.8c the site page's Bad actors card (ADR 0050 Amendment 5, ruling Q2 (a))", () => {
  afterEach(() => {
    cleanupBadActors();
  });

  it("B1 draws one card for the site and its organization, with its count, after the findings card", async () => {
    await theBodyDrawsTheCardForTheSite();
  });

  it("B2 draws the card on a dashboard view off the wall", async () => {
    await aDashboardViewOffTheWallDrawsTheCard();
  });

  it("B3 draws no card on the wall", async () => {
    await theWallDrawsNoCard();
  });

  it("B4 draws no card on the assets tab", async () => {
    await theAssetsTabDrawsNoCard();
  });

  it("B5 draws no card on the trends tab", async () => {
    await theTrendsTabDrawsNoCard();
  });

  it("B6 draws no card before the site view has answered", async () => {
    await aPendingSiteViewDrawsNoCard();
  });
});
