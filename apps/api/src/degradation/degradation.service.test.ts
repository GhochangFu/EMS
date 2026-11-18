import { describe, it } from "vitest";

import {
  aDriftPointWithNoCoveredRuleReachesNoMeanRead,
  anAssetWithNoUsableFairBandReachesNoCounterRead,
  anEmptyScopeMakesNoRead,
  aThrowingScheduleReadLeavesTheNotesOut,
  everyFleetReadGetsTheConsideredIdsOnly,
  theCapRunsTheScoreReadOnlyAbove200,
  theResponseIsTheEnginesAnswerInOrder,
  theScheduleReadRunsOnlyForAssetsWithACrossing,
  theServiceWiresTheReads,
} from "./degradation.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — DegradationService (ADR 0138)", () => {
  it("an empty scope makes no read; no candidate makes no read after the candidates", () => anEmptyScopeMakesNoRead());
  it("above 200 candidates the score read ranks them, no score last, and 200 go on; at 200 it does not run", () =>
    theCapRunsTheScoreReadOnlyAbove200());
  it("every fleet read receives the considered ids only, never null", () => everyFleetReadGetsTheConsideredIdsOnly());
  it("an asset with no usable fair band reaches no counter read", () => anAssetWithNoUsableFairBandReachesNoCounterRead());
  it("a drift point with no covered rule reaches no mean read", () => aDriftPointWithNoCoveredRuleReachesNoMeanRead());
  it("the response is the engine's answer in the plan's order and parses", () => theResponseIsTheEnginesAnswerInOrder());
  it("the schedule read runs only for assets with a crossing, with those ids", () =>
    theScheduleReadRunsOnlyForAssetsWithACrossing());
  it("a throwing schedule read gives the same response without notes and one warn with the class name only", () =>
    aThrowingScheduleReadLeavesTheNotesOut());
  it("the service wires the real reads: the pool and the health service", () => theServiceWiresTheReads());
});
