import { describe, it } from "vitest";

import {
  aNonStripWidgetIsNeverReplaced,
  anEmptyTabInsertsAtTheTop,
  aRowTieIsDecidedByGridX,
  aTabsOneStripIsReplaced,
  aTabWithoutAStripInsertsAtItsFoot,
  theTopmostStripIsReplacedFirst,
} from "./trend-strip-placement.spec";

describe("F4.306 — placeTrendStrip (ADR 0108 Amendment 7)", () => {
  it("an empty tab inserts the strip at gridY 0", () => {
    anEmptyTabInsertsAtTheTop();
  });
  it("a tab without a strip inserts at max(gridY + gridH)", () => {
    aTabWithoutAStripInsertsAtItsFoot();
  });
  it("a tab's one strip is replaced", () => {
    aTabsOneStripIsReplaced();
  });
  it("the strip with the lowest gridY is replaced first", () => {
    theTopmostStripIsReplacedFirst();
  });
  it("a row tie is decided by the lowest gridX", () => {
    aRowTieIsDecidedByGridX();
  });
  it("a widget of another type is never replaced", () => {
    aNonStripWidgetIsNeverReplaced();
  });
});
