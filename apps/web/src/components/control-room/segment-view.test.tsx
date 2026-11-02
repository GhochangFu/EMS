// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aSegmentWithNoPointsSaysWhereToAddThem,
  aTrimmedChartNamesTheCap,
  thePointSelectorListsThePointsAndEmitsAChoice,
  theRollupLineNamesTheZone,
} from "./segment-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 one segment sub-tab", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists the segment's points and emits a choice", () => {
    thePointSelectorListsThePointsAndEmitsAChoice();
  });

  it("names the rollup level, the bucket and the site zone", () => {
    theRollupLineNamesTheZone();
  });

  it("points a segment with no listed point at Reference Data → Trend Points", () => {
    aSegmentWithNoPointsSaysWhereToAddThem();
  });

  it("names the chart cap when trimmed", () => {
    aTrimmedChartNamesTheCap();
  });
});
