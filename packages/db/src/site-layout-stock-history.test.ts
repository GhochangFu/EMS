import { describe, it } from "vitest";

import {
  everyDomainTabIsUnchangedFromV2,
  onlyTheElectricalTabChangedBetweenV3AndV4,
  theCanonicalFormIgnoresKeyOrder,
  theV1ContentHoldsEveryV2WidgetAtItsV1Rect,
  theV3ContentHoldsTheV3OverviewAndTheV2ElectricalTab,
  theV3ElectricalTabHoldsItsSevenWidgetsAtTheirV3Rects,
  theV3OverviewHoldsItsEightWidgetsAtTheirV3Rects,
  theV2ContentParsesAndHoldsTheV2Overview,
  theV2OfflineTileDrawsTheAlertIcon,
  theV2OverviewHoldsItsFourteenWidgetsAtTheirV2Rects,
} from "./site-layout-stock-history.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.77 — the SMOC standard site layout's frozen stock history", () => {
  it("keeps every domain tab of the v2 content as stock v2 shipped it", () => {
    everyDomainTabIsUnchangedFromV2();
  });
  it("freezes the v2 Overview's 14 widgets at their v2 rects", () => {
    theV2OverviewHoldsItsFourteenWidgetsAtTheirV2Rects();
  });
  it("freezes the v2 Offline tile with the alert icon", () => {
    theV2OfflineTileDrawsTheAlertIcon();
  });
  it("builds a v2 content that parses and holds the v2 Overview", () => {
    theV2ContentParsesAndHoldsTheV2Overview();
  });
  it("holds every v2 widget at its v1 rect in the v1 content", () => {
    theV1ContentHoldsEveryV2WidgetAtItsV1Rect();
  });
  it("freezes the v3 Overview's eight widgets at their v3 rects", () => {
    theV3OverviewHoldsItsEightWidgetsAtTheirV3Rects();
  });
  it("freezes the v3 electrical tab's seven widgets at their v3 rects", () => {
    theV3ElectricalTabHoldsItsSevenWidgetsAtTheirV3Rects();
  });
  it("builds a v3 content with the v3 Overview and the v2 electrical tab", () => {
    theV3ContentHoldsTheV3OverviewAndTheV2ElectricalTab();
  });
  it("changes only the Overview and the electrical tab between v3 and v4", () => {
    onlyTheElectricalTabChangedBetweenV3AndV4();
  });
  it("compares config without key order", () => {
    theCanonicalFormIgnoresKeyOrder();
  });
});
