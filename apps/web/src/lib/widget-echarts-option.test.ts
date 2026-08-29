import { describe, it } from "vitest";

import {
  chartAreaSeriesIsLineWithAreaStyle,
  chartBarAndScatterMapDirectly,
  chartLineSeriesHasNoAreaStyle,
  chartNSeriesProduceNEntriesOrderedBySortOrder,
  chartStackedSetsStackOnEverySeriesAbsentSetsNone,
  chartWindowMinutesSetsTheXAxisLowerBoundRelativeToNow,
  chartYAxisLabelSetsNameAbsentOmitsIt,
  gaugeNeedleValueIsClampedIntoRange,
  gaugePutsMinMaxOnTheSeriesAndValueInData,
  gaugeThresholdOutsideRangeIsClampedNotDropped,
  gaugeThresholdsAreSortedRegardlessOfStorageOrder,
  gaugeThresholdsBecomeAscendingFractionsEndingAtOne,
} from "./widget-echarts-option.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("widget-echarts-option: buildRadialGaugeOption", () => {
  it("puts config min/max on the series and the reading in data[0].value", () => {
    gaugePutsMinMaxOnTheSeriesAndValueInData();
  });

  it("converts thresholds into ascending colour-stop fractions ending at 1", () => {
    gaugeThresholdsBecomeAscendingFractionsEndingAtOne();
  });

  it("sorts thresholds regardless of stored order", () => {
    gaugeThresholdsAreSortedRegardlessOfStorageOrder();
  });

  it("clamps a threshold outside [min,max] rather than dropping it", () => {
    gaugeThresholdOutsideRangeIsClampedNotDropped();
  });

  it("clamps the needle value into [min,max]", () => {
    gaugeNeedleValueIsClampedIntoRange();
  });
});

describe("widget-echarts-option: buildChartOption", () => {
  it("gives 'line' no areaStyle", () => {
    chartLineSeriesHasNoAreaStyle();
  });

  it("maps 'area' to a line series with areaStyle, never an 'area' series type", () => {
    chartAreaSeriesIsLineWithAreaStyle();
  });

  it("maps 'bar' and 'scatter' directly", () => {
    chartBarAndScatterMapDirectly();
  });

  it("sets stack on every series when stacked, and omits it otherwise", () => {
    chartStackedSetsStackOnEverySeriesAbsentSetsNone();
  });

  it("sets yAxis.name from yAxisLabel, and omits it when absent", () => {
    chartYAxisLabelSetsNameAbsentOmitsIt();
  });

  it("sets the x-axis lower bound from windowMinutes relative to the injected now, defaulting to a day", () => {
    chartWindowMinutesSetsTheXAxisLowerBoundRelativeToNow();
  });

  it("produces one series entry per binding, ordered by sortOrder", () => {
    chartNSeriesProduceNEntriesOrderedBySortOrder();
  });
});
