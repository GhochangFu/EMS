// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFlatScopeHasNoFilter,
  allSitesReadsWithNoParent,
  choosingAParentReadsItsSubtree,
  choosingAParentRefitsTheMap,
  cleanupMapPage,
  theFilterOffersOnlyParents,
  theSitesMapPopupOpensTheAssetsTab,
} from "./map-page.spec";

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

describe("F2.10 MapPage parent filter (ADR 0098 decision 11)", () => {
  afterEach(() => {
    cleanupMapPage();
  });

  it("F1 choosing a parent reads its subtree and draws only those pins", async () => {
    await choosingAParentReadsItsSubtree();
  });

  it("F2 the filter offers the campus and not its leaf sites", async () => {
    await theFilterOffersOnlyParents();
  });

  it("F3 choosing a parent fits the map once more, to the subtree's box", async () => {
    await choosingAParentRefitsTheMap();
  });

  it("F4 a flat scope has no filter, and the pins still render", async () => {
    await aFlatScopeHasNoFilter();
  });

  it("F5 All sites reads with no parent", async () => {
    await allSitesReadsWithNoParent();
  });
});
