import { describe, it } from "vitest";

import {
  chartAreaSeriesIsLineWithAreaStyle,
  chartBarAndScatterMapDirectly,
  chartLineSeriesHasNoAreaStyle,
  chartNSeriesProduceNEntriesOrderedBySortOrder,
  chartStackedSetsStackOnEverySeriesAbsentSetsNone,
  chartWindowMinutesSetsTheXAxisLowerBoundRelativeToNow,
  chartYAxisLabelSetsNameAbsentOmitsIt,
  gaugeDetailFormatsTheReadingWithUnitAndDecimals,
  gaugeMinOffsetIsSubtractedNotIgnored,
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

  it("subtracts a non-zero min rather than treating the range as starting at 0", () => {
    gaugeMinOffsetIsSubtractedNotIgnored();
  });

  it("formats the detail label with the configured unit and decimals, not the raw ECharts default", () => {
    gaugeDetailFormatsTheReadingWithUnitAndDecimals();
  });
});

describe("widget-echarts-option: buildChartOption", () => {
  it("gives the plain trend series no areaStyle", () => {
    chartLineSeriesHasNoAreaStyle();
  });

  it("maps the filled trend to a line series with areaStyle, never a separate series type", () => {
    chartAreaSeriesIsLineWithAreaStyle();
  });

  it("maps the bar and scatter kinds directly", () => {
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
