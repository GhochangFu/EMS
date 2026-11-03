// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aCutListSaysHowManySites,
  aWholeListSaysNothing,
  kwhPerM2IsAThirdPressableSort,
  peakKwReSortsAndIsPressed,
  rowsAreInKwhOrder,
  theChangeColumnFollowsRuling46,
  theIntensityColumnFormatsEachState,
  theIntensityModeSaysItRanksTheTopFiftyByKwh,
  theKwhModeDoesNotSayTopFifty,
  theNoAreaRowIsLast,
  thePeakTimeIsInTheViewsZone,
  withoutCompareTheChangeIsADash,
} from "./site-ranking-table.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
afterEach(() => {
  cleanup();
});

describe("F4.299 site ranking table", () => {
  it("lists the rows in kWh order", () => {
    rowsAreInKwhOrder();
  });
  it("re-sorts by peak kW and marks the pressed button", async () => {
    await peakKwReSortsAndIsPressed();
  });
  it("shows the change and the sentence for an absent site and a zero previous kWh", () => {
    theChangeColumnFollowsRuling46();
  });
  it("shows a dash in the change column without compare", () => {
    withoutCompareTheChangeIsADash();
  });
  it("formats the peak time in the view's zone", () => {
    thePeakTimeIsInTheViewsZone();
  });
  it("says how many sites a cut list leaves out", () => {
    aCutListSaysHowManySites();
  });
  it("says nothing for a whole list", () => {
    aWholeListSaysNothing();
  });
  it("F4.304 S1: offers kWh per m² as a third pressable sort", async () => {
    await kwhPerM2IsAThirdPressableSort();
  });
  it("F4.304 S2: formats the kWh/m² column — two places, < 0.01, no area", () => {
    theIntensityColumnFormatsEachState();
  });
  it("F4.304 S3: the kWh per m² mode says it ranks the top 50 by kWh", async () => {
    await theIntensityModeSaysItRanksTheTopFiftyByKwh();
  });
  it("F4.304 S3: the kWh mode does not say so", () => {
    theKwhModeDoesNotSayTopFifty();
  });
  it("F4.304 S4: puts the no-area row last", async () => {
    await theNoAreaRowIsLast();
  });
});
