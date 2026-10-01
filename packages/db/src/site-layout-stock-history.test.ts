import { describe, it } from "vitest";

import {
  everyDomainTabIsUnchangedFromV2,
  theCanonicalFormIgnoresKeyOrder,
  theV1ContentHoldsEveryV2WidgetAtItsV1Rect,
  theV2ContentParsesAndHoldsTheV2Overview,
  theV2OfflineTileDrawsTheAlertIcon,
  theV2OverviewHoldsItsFourteenWidgetsAtTheirV2Rects,
} from "./site-layout-stock-history.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.77 — the SMOC standard site layout's frozen stock history", () => {
  it("keeps every domain tab as stock v2 shipped it", () => {
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
  it("compares config without key order", () => {
    theCanonicalFormIgnoresKeyOrder();
  });
});
