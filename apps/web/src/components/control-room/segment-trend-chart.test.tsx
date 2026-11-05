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
  theLegendEntryReadsTheAssetLabel,
  anRtuLessLegendEntryReadsTheLocation,
  theSeriesAreNamedByTheAssetLabel,
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

  it("reads <code> · <RTU> in the legend (F4.316)", () => {
    theLegendEntryReadsTheAssetLabel();
  });

  it("reads <code> · <location> in an RTU-less asset's legend entry (F4.316)", () => {
    anRtuLessLegendEntryReadsTheLocation();
  });

  it("names each line by the asset label (F4.316)", () => {
    theSeriesAreNamedByTheAssetLabel();
  });

  it("renders a fixed sentence and no chart with no drawn asset", () => {
    noSeriesIsAFixedSentence();
  });
});
