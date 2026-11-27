// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aDashboardViewOffTheWallDrawsTheCard,
  aPendingSiteViewDrawsNoCard,
  cleanupFindings,
  theAssetsTabDrawsNoCard,
  theBodyDrawsTheCardForTheSite,
  theTrendsTabDrawsNoCard,
  theWallDrawsNoCard,
} from "./site-page-ml-findings.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("E1.9e the site page's findings card (ADR 0135 Amendment 8 decision 13)", () => {
  afterEach(() => {
    cleanupFindings();
  });

  it("M1 draws one compact card for the site and its organization after the body", async () => {
    await theBodyDrawsTheCardForTheSite();
  });

  it("M2 draws the card on a dashboard view off the wall", async () => {
    await aDashboardViewOffTheWallDrawsTheCard();
  });

  it("M3 draws no card on the wall", async () => {
    await theWallDrawsNoCard();
  });

  it("M4 draws no card on the assets tab", async () => {
    await theAssetsTabDrawsNoCard();
  });

  it("M5 draws no card on the trends tab", async () => {
    await theTrendsTabDrawsNoCard();
  });

  it("M6 draws no card before the site view has answered", async () => {
    await aPendingSiteViewDrawsNoCard();
  });
});
