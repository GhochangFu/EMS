// @vitest-environment jsdom
import { beforeAll, describe, it } from "vitest";

import { theMarkJoinsOnlyItsHoursTooltip, useJsdomTextMeasure } from "./asset-history-chart-option.echarts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). jsdom: a real ECharts instance. */
beforeAll(() => {
  useJsdomTextMeasure();
});

describe("E1.2b — the unusual-hour marks in a mounted ECharts chart", () => {
  it("a mark joins its own hour's axis tooltip and no other", () => theMarkJoinsOnlyItsHoursTooltip());
});
