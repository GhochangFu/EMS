// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  drawsNoCompareWhenOff,
  drawsTheCompareDashedAndShifted,
  namesTheOneUnitAxis,
  noSeriesIsAFixedSentence,
  resetRecorded,
  theLegendOpensTheHistory,
} from "./segment-trend-chart.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 the segment trend chart", () => {
  beforeEach(() => {
    resetRecorded();
  });

  afterEach(() => {
    cleanup();
  });

  it("draws the previous period dashed and moved by +span", () => {
    drawsTheCompareDashedAndShifted();
  });

  it("draws no dashed series with compare off", () => {
    drawsNoCompareWhenOff();
  });

  it("names the one unit axis", () => {
    namesTheOneUnitAxis();
  });

  it("opens the asset's history from the legend", () => {
    theLegendOpensTheHistory();
  });

  it("renders a fixed sentence and no chart with no drawn asset", () => {
    noSeriesIsAFixedSentence();
  });
});
