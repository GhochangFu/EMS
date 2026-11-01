// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aCutListSaysHowManySites,
  aWholeListSaysNothing,
  peakKwReSortsAndIsPressed,
  rowsAreInKwhOrder,
  theChangeColumnFollowsRuling46,
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
});
