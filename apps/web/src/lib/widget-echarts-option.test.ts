import { describe, it } from "vitest";

import {
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
