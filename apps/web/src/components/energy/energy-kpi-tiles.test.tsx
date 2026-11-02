// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aNullCostIsADashWithTheReason,
  aNullPfSaysNoPfPoint,
  aNullPueIsADashWithTheReason,
  aPeriodWithoutDataSaysSo,
  anEmptyPreviousPeriodSaysSo,
  rendersTheSixTilesInOrder,
  theRollupTileNamesLevelBucketAndZone,
  thePeakTileShowsThePeakKwNotTheTotal,
  thePeakTimeIsInTheViewsZone,
  theTotalTileShowsTheChange,
  theTotalTileShowsTheWholeKwh,
} from "./energy-kpi-tiles.spec";

/** `F4.302` U3 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
});

describe("F4.302 — the Energy KPI tiles", () => {
  it("renders the six tiles in order", () => {
    rendersTheSixTilesInOrder();
  });

  it("the total tile shows the whole kWh", () => {
    theTotalTileShowsTheWholeKwh();
  });

  it("the peak tile shows the peak kW, not the total", () => {
    thePeakTileShowsThePeakKwNotTheTotal();
  });

  it("the peak time is in the view's zone", () => {
    thePeakTimeIsInTheViewsZone();
  });

  it("the total tile shows the change against the previous period", () => {
    theTotalTileShowsTheChange();
  });

  it("an empty previous period says so", () => {
    anEmptyPreviousPeriodSaysSo();
  });

  it("the rollup tile names the level and the zone", () => {
    theRollupTileNamesLevelBucketAndZone();
  });

  it("a null PUE is a dash with the reason", () => {
    aNullPueIsADashWithTheReason();
  });

  it("a null cost is a dash with the reason", () => {
    aNullCostIsADashWithTheReason();
  });

  it("a null power factor says no pf point", () => {
    aNullPfSaysNoPfPoint();
  });

  it("a period without data says so", () => {
    aPeriodWithoutDataSaysSo();
  });
});
