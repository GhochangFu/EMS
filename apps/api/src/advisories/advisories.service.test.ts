import { describe, it } from "vitest";

import {
  aContextIsAddedAndChangesNoNumber,
  aShortRegisterSpanSendsTheMeterToThePairRead,
  anEmptyScopeMakesNoRead,
  aThrowingAnomalyReadLeavesTheContextOut,
  atMost25AnomalyReadsInTheResponseOrder,
  everyLaterReadGetsTheCandidateIdsOnly,
  noZoneAndEnergyOffReachNoLaterRead,
  theCapRunsTheRankingReadOnlyAbove200,
  theInputIsFilledAsTheEngineExpects,
  theServiceWiresTheReads,
} from "./advisories.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — AdvisoriesService (ADR 0137)", () => {
  it("an empty scope makes no read", () => anEmptyScopeMakesNoRead());
  it("a meter with no zone, or with energy features off, reaches no later read", () => noZoneAndEnergyOffReachNoLaterRead());
  it("201 candidates run the ranking read and 200 go on; 200 do not run it", () => theCapRunsTheRankingReadOnlyAbove200());
  it("every later read receives only candidate ids, never null", () => everyLaterReadGetsTheCandidateIdsOnly());
  it("registers spanning under 0.8 of the window send the meter to the pair read; at 0.8 they do not", () =>
    aShortRegisterSpanSendsTheMeterToThePairRead());
  it("the engine input is filled exactly as the engine's fixture", () => theInputIsFilledAsTheEngineExpects());
  it("a throwing anomaly read gives the advisories without context", () => aThrowingAnomalyReadLeavesTheContextOut());
  it("a context line is added and changes no number", () => aContextIsAddedAndChangesNoNumber());
  it("at most 25 anomaly reads, in the response's order", () => atMost25AnomalyReadsInTheResponseOrder());
  it("the class reads nothing for an empty scope; the adapters pass each read through", () => theServiceWiresTheReads());
});
