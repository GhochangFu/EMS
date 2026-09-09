import { describe, it } from "vitest";

import {
  testAClearedMessageIsOnTheReservedBudgetToo,
  testADispatchWithNoEventIsTheFullBudget,
  testAReofferedRaiseKeepsTheFullBudget,
  testAReservedCeilingRoundsDownToZeroAtARateOfOne,
  testAnEscalationStepIsOnTheReservedBudget,
  testAnEventKeyCarriesTheSegmentTheReservedFilterAsksFor,
  testTheEventPathStopsAtFourFifthsOfTheCeiling,
  testTheRaisePathKeepsTheWholeCeiling,
} from "./dispatch-policy.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per claim, deliberately: `assert` throws, so a single `it()` over
 * all of them would stop at the first failure and a mutation could never be
 * shown to redden the case that owns it.
 */
describe("F3.52 dispatch policy: the hourly ceiling's two budgets", () => {
  it("keeps the whole ceiling for the raise path", () => {
    testTheRaisePathKeepsTheWholeCeiling();
  });

  it("stops the event path at four fifths of the ceiling", () => {
    testTheEventPathStopsAtFourFifthsOfTheCeiling();
  });

  it("rounds a reserved ceiling down to zero at a rate of one", () => {
    testAReservedCeilingRoundsDownToZeroAtARateOfOne();
  });

  it("puts a dispatch with no event on the full budget", () => {
    testADispatchWithNoEventIsTheFullBudget();
  });

  it("puts an escalation step on the reserved budget", () => {
    testAnEscalationStepIsOnTheReservedBudget();
  });

  it("puts a cleared message on the reserved budget too", () => {
    testAClearedMessageIsOnTheReservedBudgetToo();
  });

  it("keeps a re-offered raise on the full budget", () => {
    testAReofferedRaiseKeepsTheFullBudget();
  });

  it("gives an event key the segment the reserved filter asks for", () => {
    testAnEventKeyCarriesTheSegmentTheReservedFilterAsksFor();
  });
});
