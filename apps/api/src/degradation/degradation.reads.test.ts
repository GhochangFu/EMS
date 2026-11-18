import { describe, it } from "vitest";

import {
  aCandidateRowListsItsDriftPoints,
  theAssetFilterIsChosenByIdsBeingNull,
  theCandidateStatementHoldsTheRealLineAndTheActiveFlags,
  theCounterReadSumsTheCountsAndTakesTheMaxOfTheTallies,
  theMeanReadIsTheHourlyAggregateGroupedByLocalDay,
  theScheduleStatementReadsActiveSchedulesOfTheIds,
  theTargetClassesAreBoundArraysNotText,
} from "./degradation.reads.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — the degradation reads (ADR 0138)", () => {
  it("the candidate statement holds the ML real line, a.active and ap.active", () =>
    theCandidateStatementHoldsTheRealLineAndTheActiveFlags());
  it("the target classes are three bound arrays, not text", () => theTargetClassesAreBoundArraysNotText());
  it("the asset filter is chosen by ids === null, and the ids are one bound array", () =>
    theAssetFilterIsChosenByIdsBeingNull());
  it("a candidate row lists its drift points", () => aCandidateRowListsItsDriftPoints());
  it("the schedule statement reads the active schedules of the ids, the organization on both joins", () =>
    theScheduleStatementReadsActiveSchedulesOfTheIds());
  it("the counter read binds unnest($1::uuid[], $2::text[]), sums the counts and takes the max of the tallies", () =>
    theCounterReadSumsTheCountsAndTakesTheMaxOfTheTallies());
  it("the mean read is the _1h aggregate with avgExpr, grouped by the local day", () =>
    theMeanReadIsTheHourlyAggregateGroupedByLocalDay());
});
