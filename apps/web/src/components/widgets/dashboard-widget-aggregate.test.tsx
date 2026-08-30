// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  anEmptyWindowRendersEmDashesNotNullOrInvalidDate,
  theChartFooterRendersItsThreeCellsOnlyWhenAsked,
  theComputedDeltaTakesTheHintSlotAlone,
  theGranularityCellNamesTheBucketWidth,
  theTilesIconToneAndSubLineReachTheDom,
} from "./dashboard-widget-aggregate.spec";

/** `F3.35` Stage A — Vitest entry point for the aggregate renderers (ADR 0014, ADR 0042). */
afterEach(() => {
  cleanup();
});

describe("F3.35 Stage A — the chart footer", () => {
  it("renders Peak, Average and Granularity, and only when the config asks", () => {
    theChartFooterRendersItsThreeCellsOnlyWhenAsked();
  });

  it("names the bucket width the response reported", () => {
    theGranularityCellNamesTheBucketWidth();
  });

  it("renders em dashes for an empty window, never 'null' or 'Invalid Date'", () => {
    anEmptyWindowRendersEmDashesNotNullOrInvalidDate();
  });
});

describe("F3.35 Stage A — the tile's presentation fields", () => {
  it("turns an icon NAME into an element, and reaches KpiTile's tone and sub-line", () => {
    theTilesIconToneAndSubLineReachTheDom();
  });

  it("gives the computed delta the hint slot alone, not a second line", () => {
    theComputedDeltaTakesTheHintSlotAlone();
  });
});
