// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCompareChartSaysNothing,
  aDonutSaysHowManyPointsItLeftOut,
  aDonutStillLoadingSaysNothing,
  aDonutWithEveryShareSaysNothing,
} from "./chart-widget.spec";

vi.mock("echarts-for-react", () => ({ default: () => null }));

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.322 chart widget — the donut's left-out line", () => {
  afterEach(() => cleanup());

  it("says how many points have no share", () => aDonutSaysHowManyPointsItLeftOut());
  it("says nothing when every point has a share", () => aDonutWithEveryShareSaysNothing());
  it("says nothing while the reads have not answered", () => aDonutStillLoadingSaysNothing());
  it("says nothing on a compare chart", () => aCompareChartSaysNothing());
});
