// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aFullGridHasNoNoDataLabel,
  aMissingCellIsLabelledNoData,
  anErrorHeatmapRendersTheFixedSentence,
  oneHeatmapSeriesWithOnePointPerCell,
  resetRecorded,
  theAxesAre24HoursAndTheDays,
  theColourScaleTopIsTheNearestRankP95,
} from "./energy-heatmap.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetRecorded();
});
afterEach(() => {
  cleanup();
});

describe("F4.299 energy heatmap", () => {
  it("draws one heatmap series with one point per cell", () => {
    oneHeatmapSeriesWithOnePointPerCell();
  });
  it("tops the colour scale at the nearest-rank P95", () => {
    theColourScaleTopIsTheNearestRankP95();
  });
  it("has 24 hour labels and the days on the axes", () => {
    theAxesAre24HoursAndTheDays();
  });
  it("labels blank cells no data when a cell is missing", () => {
    aMissingCellIsLabelledNoData();
  });
  it("has no no-data label for a full grid", () => {
    aFullGridHasNoNoDataLabel();
  });
  it("renders a fixed sentence on error", () => {
    anErrorHeatmapRendersTheFixedSentence();
  });
});
