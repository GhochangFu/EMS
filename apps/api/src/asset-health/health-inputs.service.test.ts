import { describe, it } from "vitest";

import {
  aFailedAnomalyReadKeepsTheRuleScores,
  aFailedFactReadIsQuiet,
  anEmptyScopeReadsNothing,
  badActorsScoresTheScopeOnce,
  forAssetReadsEachFactInItsOwnTransaction,
  theAnomalyReadGetsExactlyTheInScopeIds,
} from "./health-inputs.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.8a — HealthInputsService (ADR 0050 Amendment 5, plan T1.6)", () => {
  it("forAsset: the anomaly read, then the ticket read, each in its own transaction", () =>
    forAssetReadsEachFactInItsOwnTransaction());
  it("a failed fact read is quiet: null for that fact, one warn with no id, SQL or message, no throw", () =>
    aFailedFactReadIsQuiet());
  it("badActors: scoresInScope is called once with the caller's ids, the location and the window", () =>
    badActorsScoresTheScopeOnce());
  it("badActors: the anomaly read and its routing get exactly the in-scope ids", () =>
    theAnomalyReadGetsExactlyTheInScopeIds());
  it("badActors: an empty scope reads nothing; no rule score skips the label read", () => anEmptyScopeReadsNothing());
  it("badActors: a failed anomaly read gives anomaly null and keeps the rule scores", () =>
    aFailedAnomalyReadKeepsTheRuleScores());
});
