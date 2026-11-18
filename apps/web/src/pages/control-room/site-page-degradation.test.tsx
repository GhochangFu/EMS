// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aDashboardViewOffTheWallDrawsTheCard,
  aPendingSiteViewDrawsNoCard,
  cleanupDegradation,
  theAssetsTabDrawsNoCard,
  theBodyDrawsTheCardForTheSite,
  theTrendsTabDrawsNoCard,
  theWallDrawsNoCard,
} from "./site-page-degradation.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("E1.5b the site page's Trending toward a limit card (ADR 0138 decision 5)", () => {
  afterEach(() => {
    cleanupDegradation();
  });

  it("D1 draws one card for the site and its organization, directly after Bad actors", async () => {
    await theBodyDrawsTheCardForTheSite();
  });

  it("D2 draws the card on a dashboard view off the wall", async () => {
    await aDashboardViewOffTheWallDrawsTheCard();
  });

  it("D3 draws no card on the wall", async () => {
    await theWallDrawsNoCard();
  });

  it("D4 draws no card on the assets tab", async () => {
    await theAssetsTabDrawsNoCard();
  });

  it("D5 draws no card on the trends tab", async () => {
    await theTrendsTabDrawsNoCard();
  });

  it("D6 draws no card before the site view has answered", async () => {
    await aPendingSiteViewDrawsNoCard();
  });
});
