import { describe, it } from "vitest";

import {
  aLongRuleNameIsCut,
  aMissingUnitLeavesNoGap,
  driftBeyondTheHorizon,
  fallingDriftReadsDown,
  noAdvice,
  noClaimBeyondTheTrend,
  numbersAndTheRangeDash,
  p1HealthStringsAreExact,
  p2DriftStringsAreExact,
  p4HealthBeyondTheHorizon,
  p5HealthRangeReadsToMoreThanNinety,
  theScheduleNote,
} from "./degradation-lines.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — degradation sentences and assumptions (ADR 0138, plan §4.9)", () => {
  it("P1: every health string exactly", () => p1HealthStringsAreExact());
  it("P5: the health range reads 'to more than 90'", () => p5HealthRangeReadsToMoreThanNinety());
  it("P4: health beyond the horizon", () => p4HealthBeyondTheHorizon());
  it("P2: every drift string exactly", () => p2DriftStringsAreExact());
  it("drift beyond the horizon", () => driftBeyondTheHorizon());
  it("a falling drift reads 'trending down'", () => fallingDriftReadsDown());
  it("a missing unit leaves no gap", () => aMissingUnitLeavesNoGap());
  it("numbers: at most 2 decimals; the en dash", () => numbersAndTheRangeDash());
  it("the schedule note; '1 day' singular", () => theScheduleNote());
  it("a 200-character rule name is cut to 120 with '…'", () => aLongRuleNameIsCut());
  it("no failure, useful-life, confidence or stray % wording", () => noClaimBeyondTheTrend());
  it("no advice", () => noAdvice());
});
