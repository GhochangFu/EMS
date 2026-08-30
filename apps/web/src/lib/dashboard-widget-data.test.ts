import { describe, it } from "vitest";

import {
  runChartSeriesOrderingTests,
  runPointRefsForTests,
  runSingleValueWidgetTests,
  runStalenessTests,
  runZeroBindingsTests,
} from "./dashboard-widget-data.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard widget data", () => {
  it("collects the distinct point refs a dashboard's widgets need data for", () => {
    runPointRefsForTests();
  });

  it("renders a widget with zero bindings as the non-ready empty branch", () => {
    runZeroBindingsTests();
  });

  it("reads a single-value widget's primary from its bound point's latest reading", () => {
    runSingleValueWidgetTests();
  });

  it("orders a chart's series by sortOrder, not by array position", () => {
    runChartSeriesOrderingTests();
  });

  it("ages a reading through the ADR 0027 staleness gate rather than showing it as live forever", () => {
    runStalenessTests();
  });
});
