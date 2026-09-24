import { describe, it } from "vitest";

import {
  aNullLoadPriorKeepsTheFixedHint,
  aNullPuePriorHasNoDeltaText,
  anAlarmDeltaGoesInTheHint,
  anUnsettledQueryShowsTheFixedLines,
  aPueFallIsADownDelta,
  aTenPercentLoadRiseIsAnUpDelta,
  criticalCountIsTheNote,
  noAlarmDeltaReadsActiveNotYetCleared,
  noCriticalMeansNoNote,
} from "./kpi-ribbon.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 executive KPI ribbon hints", () => {
  it("renders a 10 % load rise as an up delta", () => {
    aTenPercentLoadRiseIsAnUpDelta();
  });

  it("keeps the fixed load hint when the prior is null", () => {
    aNullLoadPriorKeepsTheFixedHint();
  });

  it("reads 'Active — not yet cleared' with no alarm delta", () => {
    noAlarmDeltaReadsActiveNotYetCleared();
  });

  it("puts an alarm delta in the hint", () => {
    anAlarmDeltaGoesInTheHint();
  });

  it("puts the critical count in the note", () => {
    criticalCountIsTheNote();
  });

  it("has no note without a critical alarm", () => {
    noCriticalMeansNoNote();
  });

  it("renders a PUE fall as a down delta", () => {
    aPueFallIsADownDelta();
  });

  it("has no PUE delta text when the prior is null", () => {
    aNullPuePriorHasNoDeltaText();
  });

  it("shows every fixed line while the query is unsettled", () => {
    anUnsettledQueryShowsTheFixedLines();
  });
});
