// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFlatListDrawsNoHeader,
  aParentThatHoldsAssetsDrawsNoOpenLink,
  anotherSelectionLeavesTheHeaderUnpressed,
  cleanupSiteCardGroups,
  noCardForAnAssetLessParent,
  theHeaderTextIsTheParentAndItsRollup,
  theOpenLinkSitsBesideTheHeaderButton,
  theOpenLinkSitsBesideTheHeading,
  withOnSelectParentTheHeaderIsAPressedButton,
  withoutOnSelectParentTheHeaderIsAHeading,
} from "./site-card-groups.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.240 SiteCardGroups (ADR 0139 decisions 13–14)", () => {
  afterEach(() => {
    cleanupSiteCardGroups();
  });

  it("H1 reads the parent's name and its roll-up in the header", () => {
    theHeaderTextIsTheParentAndItsRollup();
  });

  it("H2 is a pressed button that selects the parent when onSelectParent is given", () => {
    withOnSelectParentTheHeaderIsAPressedButton();
  });

  it("H2b reads aria-pressed false when another parent is the filter", () => {
    anotherSelectionLeavesTheHeaderUnpressed();
  });

  it("H3 is a heading, and no button, without onSelectParent", () => {
    withoutOnSelectParentTheHeaderIsAHeading();
  });

  it("H4 draws no card for an asset-less parent; loose cards come first", () => {
    noCardForAnAssetLessParent();
  });

  it("H5 draws no header for a flat list", () => {
    aFlatListDrawsNoHeader();
  });

  it("H7 draws an Open link beside the header button, not inside it (F4.240 part b)", () => {
    theOpenLinkSitsBesideTheHeaderButton();
  });

  it("H8 draws the Open link beside the heading (F4.240 part b)", () => {
    theOpenLinkSitsBesideTheHeading();
  });

  it("H9 draws no Open link for a parent that holds assets (F4.240 part b)", () => {
    aParentThatHoldsAssetsDrawsNoOpenLink();
  });
});
