import { describe, it } from "vitest";

import {
  aChartLookingBodyIsNotTheTrendArm,
  aColourIsSetAndDefaultDeletesIt,
  addingASegmentAppendsIt,
  aFullTabWithAStripIsNotAtCap,
  aFullTabWithoutAStripIsAtCap,
  aGroupTabSetsTabKey,
  aSecondVisitKeepsEditsAndDefaultsOnlyTheFresh,
  anEmptyTabInsertsAtTop,
  aTablessAppendBodyHasNoTabKey,
  aTablessDashboardIsOneRow,
  droppingASegmentDropsItsPointsAndColours,
  emptyPointsAreOmitted,
  insertLandsAtTheFootOfItsTabOnly,
  insertSizeIsTheCatalogDefault,
  noSelectionIsTheF4305Config,
  replaceKeepsTheRowAndEveryOther,
  replaceRemovesAStaleColors,
  theAddedDefaultsStopAtThirty,
  theAppendBodyIsTheTrendArm,
  theBuilderRowShapeReadsByTabKey,
  theDefaultPicksThreeActivePerSegment,
  theDefaultStopsAtThirty,
  theOverviewOmitsTabKey,
  theTabListMarksHasStrip,
  theThirtiethToggleIsAccepted,
  theThirtyFirstToggleIsRefused,
  togglingAPointOffDropsItsColour,
} from "./trend-strip-wizard.spec";

/** Vitest entry point (ADR 0014) — assertions live in `trend-strip-wizard.spec.ts`. */
describe("F4.306 U11 trend strip wizard — tabs", () => {
  it("sorts the tabs and marks the tab with a strip", () => {
    theTabListMarksHasStrip();
  });

  it("marks a full tab without a strip at cap", () => {
    aFullTabWithoutAStripIsAtCap();
  });

  it("does not mark a full tab with a strip at cap", () => {
    aFullTabWithAStripIsNotAtCap();
  });

  it("reads the builder row shape by tabKey", () => {
    theBuilderRowShapeReadsByTabKey();
  });

  it("reads a tab-less dashboard as one row", () => {
    aTablessDashboardIsOneRow();
  });
});

describe("F4.306 U11 trend strip wizard — selection", () => {
  it("defaults to the first 3 active points of each chosen segment", () => {
    theDefaultPicksThreeActivePerSegment();
  });

  it("stops the default at 30 points", () => {
    theDefaultStopsAtThirty();
  });

  it("keeps the chosen points and colours on a second visit and defaults only the fresh segment", () => {
    aSecondVisitKeepsEditsAndDefaultsOnlyTheFresh();
  });

  it("stops the added defaults at 30 points and never cuts a kept point", () => {
    theAddedDefaultsStopAtThirty();
  });

  it("accepts the 30th point", () => {
    theThirtiethToggleIsAccepted();
  });

  it("refuses a 31st point", () => {
    theThirtyFirstToggleIsRefused();
  });

  it("drops a point's colour with the point", () => {
    togglingAPointOffDropsItsColour();
  });

  it("drops a segment's points and colours with the segment", () => {
    droppingASegmentDropsItsPointsAndColours();
  });

  it("appends an added segment with no point", () => {
    addingASegmentAppendsIt();
  });

  it("sets a colour and deletes it on Default", () => {
    aColourIsSetAndDefaultDeletesIt();
  });
});

describe("F4.306 U11 trend strip wizard — config", () => {
  it("sets tabKey on a group tab", () => {
    aGroupTabSetsTabKey();
  });

  it("omits tabKey on the Overview", () => {
    theOverviewOmitsTabKey();
  });

  it("omits an empty points list", () => {
    emptyPointsAreOmitted();
  });

  it("writes the F4.305 config with no selection", () => {
    noSelectionIsTheF4305Config();
  });
});

describe("F4.306 U11 trend strip wizard — builder draft", () => {
  it("replaces the tab's strip and keeps every other row", () => {
    replaceKeepsTheRowAndEveryOther();
  });

  it("removes a stale stored colour on replace", () => {
    replaceRemovesAStaleColors();
  });

  it("inserts at the foot of its own tab only", () => {
    insertLandsAtTheFootOfItsTabOnly();
  });

  it("inserts at the catalog's default size", () => {
    insertSizeIsTheCatalogDefault();
  });

  it("inserts at the top of an empty tab", () => {
    anEmptyTabInsertsAtTop();
  });
});

describe("F4.306 U11 trend strip wizard — append body", () => {
  it("builds the trend arm with one strip per tab", () => {
    theAppendBodyIsTheTrendArm();
  });

  it("sends no tabKey on a tab-less dashboard", () => {
    aTablessAppendBodyHasNoTabKey();
  });

  it("refuses a chart-looking body", () => {
    aChartLookingBodyIsNotTheTrendArm();
  });
});
