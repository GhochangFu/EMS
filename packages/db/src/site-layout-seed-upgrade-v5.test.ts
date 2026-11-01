import { describe, it } from "vitest";

import {
  aChainOfCrossingsRaisesTheCutToTheLast,
  aCopyWithNoTabPlansNothing,
  aCrossingWidgetRaisesTheCut,
  aGroupTabStripNamesItsOwnTab,
  aMovedTileRaisesTheCut,
  anEmptyTabGetsTheStripAtTheTop,
  aStockV4OverviewGainsOneStripUnderItsTiles,
  aTabHoldingAStripIsLeftWhole,
  aTabWithNoTileGetsTheStripAtTheTop,
  everyMoveIsTheStripsHeightDown,
  thePlanDoesNotDependOnTheRowOrder,
  theStepOnStockV4GivesStockV5,
  theStripNeverOverlaps,
} from "./site-layout-seed-upgrade-v5.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.305 — the seed upgrade's v5 trend strip step", () => {
  it("V5-1: gives the stock v4 Overview one whole-site strip under its tiles and moves the body down 4", () => {
    aStockV4OverviewGainsOneStripUnderItsTiles();
  });
  it("V5-2: gives a group tab a strip that names its own tab key", () => {
    aGroupTabStripNamesItsOwnTab();
  });
  it("V5-3: leaves a tab that already holds a trend strip whole, and still plans the other tab", () => {
    aTabHoldingAStripIsLeftWhole();
  });
  it("V5-4: puts the strip at the top of a tab with no value tile", () => {
    aTabWithNoTileGetsTheStripAtTheTop();
  });
  it("V5-5: puts the strip under a tile moved down a row (cut 3)", () => {
    aMovedTileRaisesTheCut();
  });
  it("V5-6: raises the cut past a widget that crosses the tile row's line (cut 3)", () => {
    aCrossingWidgetRaisesTheCut();
  });
  it("V5-6b: raises the cut through a chain of crossings", () => {
    aChainOfCrossingsRaisesTheCutToTheLast();
  });
  it("V5-7: never overlaps a widget, on every fixture", () => {
    theStripNeverOverlaps();
  });
  it("V5-7b: moves exactly the widgets at or below the strip, by exactly 4 rows", () => {
    everyMoveIsTheStripsHeightDown();
  });
  it("V5-8: plans nothing for a copy with no tab", () => {
    aCopyWithNoTabPlansNothing();
  });
  it("V5-8b: gives an empty tab its strip at the top", () => {
    anEmptyTabGetsTheStripAtTheTop();
  });
  it("V5-9: plans the same whatever the row order", () => {
    thePlanDoesNotDependOnTheRowOrder();
  });
  it("V5-10: lands every tab of the frozen stock v4 on the live stock v5", () => {
    theStepOnStockV4GivesStockV5();
  });
});
