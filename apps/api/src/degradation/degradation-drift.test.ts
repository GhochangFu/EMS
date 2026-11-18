import { describe, it } from "vitest";

import {
  aDayNeedsSamples,
  aPassedRuleGivesWayToTheNextAhead,
  aRuleInAnotherUnitIsSkipped,
  fallingNeedsARuleBelow,
  noCoveredRuleIsNoIndicator,
  risingTowardGtEightTakesThatRule,
  theNearerRuleAheadWins,
} from "./degradation-drift.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — point drift (ADR 0138, plan §4.6)", () => {
  it("P2: rising toward gt 8 takes that rule", () => risingTowardGtEightTakesThatRule());
  it("Q2 (a): a passed gt 7 gives way to the gt 9 ahead", () => aPassedRuleGivesWayToTheNextAhead());
  it("falling with only gt rules gives none; a lt rule below is taken", () => fallingNeedsARuleBelow());
  it("the nearer rule ahead wins; ties by name, then id", () => theNearerRuleAheadWins());
  it("a rule in another unit is skipped through covers", () => aRuleInAnotherUnitIsSkipped());
  it("no covered rule gives no indicator", () => noCoveredRuleIsNoIndicator());
  it("a day needs samples to have a value", () => aDayNeedsSamples());
});
