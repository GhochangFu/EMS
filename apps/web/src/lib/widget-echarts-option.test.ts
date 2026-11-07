import { describe, it } from "vitest";

import {
  chartAreaSeriesIsLineWithAreaStyle,
  chartCompareDrawsOneHorizontalBarPerPointInOrder,
  chartColoursFollowThePointPosition,
  compareAndDonutColourEachPointsBarAndSlice,
  heatmapScaleTakesTheFirstColour,
  coloursPastTheLastPointAreIgnored,
  chartDonutDrawsOnePositiveSlicePerPoint,
  chartHeatmapDrawsDaysAcrossAndHoursDown,
  heatmapCellsAreLocalDayAndHour,
  heatmapKeepsAnEmptyDay,
  heatmapMergesARepeatedLocalHour,
  chartStepHoldsTheValueUntilTheNextSample,
  donutLeftOutCountsThePointsWithNoShare,
  chartBarAndScatterMapDirectly,
  chartSeriesColoursAreTheRolePalette,
  chartLegendNamesEverySeriesInOrderWhenThereIsMoreThanOne,
  chartLineSeriesHasNoAreaStyle,
  chartNSeriesProduceNEntriesOrderedBySortOrder,
  chartSingleSeriesGetsNoLegend,
  chartStackedSetsStackOnEverySeriesAbsentSetsNone,
  chartWindowMinutesSetsTheXAxisLowerBoundRelativeToNow,
  chartYAxisLabelSetsNameAbsentOmitsIt,
  gaugeDetailFormatsTheReadingWithUnitAndDecimals,
  gaugeMinOffsetIsSubtractedNotIgnored,
  gaugeNeedleValueIsClampedIntoRange,
  gaugeReadoutClearsTheDialAndTheAxisIsNotOverLabelled,
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

  it("draws the readout below the dial and does not over-label the axis", () => {
    gaugeReadoutClearsTheDialAndTheAxisIsNotOverLabelled();
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

  it("names every series in a legend, ordered like the series, when there is more than one", () => {
    chartLegendNamesEverySeriesInOrderWhenThereIsMoreThanOne();
  });

  it("draws no legend for a single series", () => {
    chartSingleSeriesGetsNoLegend();
  });

  it("carries the series colours from the role palette (F3.65c)", () => {
    chartSeriesColoursAreTheRolePalette();
  });
});

describe("widget-echarts-option: F4.323 chart kinds (ADR 0047 Amendment 7)", () => {
  it("step is a line that holds its value until the next sample", () => chartStepHoldsTheValueUntilTheNextSample());
  it("compare draws one horizontal bar per point, in sortOrder", () => chartCompareDrawsOneHorizontalBarPerPointInOrder());
  it("donut draws one slice per point with a positive number", () => chartDonutDrawsOnePositiveSlicePerPoint());
  it("donutLeftOut counts the points with no share", () => donutLeftOutCountsThePointsWithNoShare());
  it("heatmap cells are the bucket's local day and hour", () => heatmapCellsAreLocalDayAndHour());
  it("heatmap merges a fall-back hour by the widget's function", () => heatmapMergesARepeatedLocalHour());
  it("heatmap keeps a day with no samples on the axis", () => heatmapKeepsAnEmptyDay());
  it("heatmap draws days across and hours down in one hue", () => chartHeatmapDrawsDaysAcrossAndHoursDown());
});

describe("widget-echarts-option: F4.325 a colour per point (ADR 0047 Amendment 8)", () => {
  it("the time kinds colour each series by its point's position", () => chartColoursFollowThePointPosition());
  it("compare and donut colour each point's bar and slice", () => compareAndDonutColourEachPointsBarAndSlice());
  it("a heatmap's scale takes the first colour", () => heatmapScaleTakesTheFirstColour());
  it("a colour past the last point is ignored", () => coloursPastTheLastPointAreIgnored());
});
