// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import { cleanupMapPage, theSitesMapPopupOpensTheAssetsTab } from "./map-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.79 MapPage keeps its popup link", () => {
  afterEach(() => {
    cleanupMapPage();
  });

  it("M1 links a pin's popup to the site's Assets & RTUs tab", async () => {
    await theSitesMapPopupOpensTheAssetsTab();
  });
});
