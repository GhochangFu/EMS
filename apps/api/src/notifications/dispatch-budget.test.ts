import { describe, it } from "vitest";

import {
  testAManualTestMeetsTheReducedEventLimit,
  testTheRaiseReachesSlotsTheEventPathCannot,
  testTheReservedLimitIsFortyEightAndItIsInclusive,
} from "./dispatch-budget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case, so a mutation can be shown to redden the case that owns
 * it. B1 and B2 are one `it()` on purpose: they share a fixture and a count,
 * which is what makes the pair discriminating.
 */
describe("F3.52 the hourly ceiling's three callers", () => {
  it("lets a raise reach slots the event path cannot, off one count", async () => {
    await testTheRaiseReachesSlotsTheEventPathCannot();
  });

  it("holds a manual test to the reduced event limit", async () => {
    await testAManualTestMeetsTheReducedEventLimit();
  });

  it("refuses at the reserved limit and sends one under it", async () => {
    await testTheReservedLimitIsFortyEightAndItIsInclusive();
  });
});
