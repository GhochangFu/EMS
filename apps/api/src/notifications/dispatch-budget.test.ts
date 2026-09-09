import { describe, it } from "vitest";

import {
  testAManualTestMeetsTheReducedEventLimit,
  testAReserveFullOfEventsStillLetsARaiseThrough,
  testARaiseBacklogNoLongerRefusesTheEventPath,
  testATestSendsOwnRowIsCountedAgainstTheReserve,
  testTheFullCeilingStillBindsARaise,
  testTheReserveStillRefusesAStepOnEventRows,
  testTheReservedLimitIsFortyEightAndItIsInclusive,
} from "./dispatch-budget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case, so a mutation can be shown to redden the case that owns
 * it. N2 and N3 run the same fixture in two `it()`s on purpose: `assert` throws,
 * so a pair inside one block would never reach the second half once the first
 * reddened, and the second half is the one that says the reserve protects the
 * raise.
 */
describe("F3.52 the hourly ceiling's two limits and three callers", () => {
  it("lets an escalation step through a backlog of sent raises", async () => {
    await testARaiseBacklogNoLongerRefusesTheEventPath();
  });

  it("still refuses a step once the event rows themselves reach the reserve", async () => {
    await testTheReserveStillRefusesAStepOnEventRows();
  });

  it("still lets a raise through with the reserve full of events", async () => {
    await testAReserveFullOfEventsStillLetsARaiseThrough();
  });

  it("still binds a raise at the full ceiling, whatever the mix", async () => {
    await testTheFullCeilingStillBindsARaise();
  });

  it("holds a manual test to the reduced event limit", async () => {
    await testAManualTestMeetsTheReducedEventLimit();
  });

  it("refuses at the reserved limit and sends one under it", async () => {
    await testTheReservedLimitIsFortyEightAndItIsInclusive();
  });

  it("counts a test send's own row against the reserved limit", async () => {
    await testATestSendsOwnRowIsCountedAgainstTheReserve();
  });
});
