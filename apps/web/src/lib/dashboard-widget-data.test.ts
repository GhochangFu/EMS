import { describe, it } from "vitest";

import {
  runChartSeriesOrderingTests,
  runPointRefsForTests,
  runSeriesNameForTests,
  runSeriesNameFormTests,
  runSeriesNameNamesTheLocationWithoutAnRtuTests,
  runSeriesNameNamesTheRtuTests,
  runSeriesNamesSplitTheSameCodeUnderTwoRtusTests,
  runSeriesNamesAreDistinctTests,
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

  it("F3.43 — two series that share a pointKey on different assets carry distinct names", () => {
    runSeriesNamesAreDistinctTests();
  });

  it("F3.43 — a series is named <assetCode> · <pointKey>", () => {
    runSeriesNameFormTests();
  });

  it("F3.43 — seriesNameFor composes the two fields with a middle dot", () => {
    runSeriesNameForTests();
  });

  it("F4.316 PR 5 — a series on an asset with an RTU is named <code> · <RTU> · <pointKey>", () => {
    runSeriesNameNamesTheRtuTests();
  });

  it("F4.316 PR 5 — a series on an RTU-less asset is named <code> · <location> · <pointKey>", () => {
    runSeriesNameNamesTheLocationWithoutAnRtuTests();
  });

  it("F4.316 PR 5 — one code under two RTUs carries two series names", () => {
    runSeriesNamesSplitTheSameCodeUnderTwoRtusTests();
  });
});
