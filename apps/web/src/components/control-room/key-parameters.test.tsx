// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aStaleUps1DrawsNoDial,
  aStaleUps1ShowsADashAndOffline,
  aFreshNullUps1ShowsADashAndNoData,
  aStaleUps2DrawsNoDial,
  bothBatteriesStaleDrawNoDial,
  aStaleMainDrawsNoPowerFactorDial,
  ups1NeedleReadsItsLoad,
  ups2NeedleReadsItsLoad,
  batteryNeedleReadsTheAverageOfBothFreshUnits,
  batteryNeedleAveragesOnlyTheFreshUnit,
  powerFactorNeedleReadsTheMainPf,
  batteryHealthBandsFallFromOkToCritical,
  powerFactorBandsAreWarningBelowPointNine,
  rendersTheFourGaugeTitles,
  upsLoadBandsRiseFromOkToCritical,
} from "./key-parameters.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 Key Parameters gauges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the four gauge titles", () => {
    rendersTheFourGaugeTitles();
  });

  it("draws no dial for a stale UPS-1, and one for live UPS-2", () => {
    aStaleUps1DrawsNoDial();
  });

  it("shows a dash and Offline, not No data, for a stale UPS-1", () => {
    aStaleUps1ShowsADashAndOffline();
  });

  it("shows a dash and No data, not Offline, for a fresh UPS-1 with no reading", () => {
    aFreshNullUps1ShowsADashAndNoData();
  });

  it("draws no dial for a stale UPS-2, and one for live UPS-1", () => {
    aStaleUps2DrawsNoDial();
  });

  it("draws no battery dial when both units are stale", () => {
    bothBatteriesStaleDrawNoDial();
  });

  it("draws no power factor dial for a stale main incomer", () => {
    aStaleMainDrawsNoPowerFactorDial();
  });

  it("puts the UPS-1 needle at its load", () => {
    ups1NeedleReadsItsLoad();
  });

  it("puts the UPS-2 needle at its load", () => {
    ups2NeedleReadsItsLoad();
  });

  it("puts the battery needle at the average of both fresh units", () => {
    batteryNeedleReadsTheAverageOfBothFreshUnits();
  });

  it("averages only the fresh battery unit: batt1 90 fresh, batt2 50 stale give 90", () => {
    batteryNeedleAveragesOnlyTheFreshUnit();
  });

  it("puts the power factor needle at the main incomer's pf", () => {
    powerFactorNeedleReadsTheMainPf();
  });

  it("paints the UPS load bands ok, warning from 80, critical from 95", () => {
    upsLoadBandsRiseFromOkToCritical();
  });

  it("paints the battery health bands critical below 70, warning below 85, ok from 85", () => {
    batteryHealthBandsFallFromOkToCritical();
  });

  it("paints the power factor bands warning below 0.9, ok from 0.9", () => {
    powerFactorBandsAreWarningBelowPointNine();
  });
});
