import { describe, it } from "vitest";

import {
  testAStaleStepIsStillDispatched,
  testAStepPastTheBoundIsFlagged,
  testAStepTenMinutesLateIsNotFlagged,
  testStalenessIsPerStepNotPerAlarm,
} from "./alarm-lifecycle-escalation-staleness.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case: `assert` throws, so a shared `it()` would let a mutation
 * redden an earlier case while the case that owns the claim never ran.
 */
describe("F3.52 the escalation phase decides an age per step", () => {
  it("leaves a step ten minutes past due unflagged", async () => {
    await testAStepTenMinutesLateIsNotFlagged();
  });

  it("flags a step 61 minutes past due", async () => {
    await testAStepPastTheBoundIsFlagged();
  });

  it("still dispatches the stale step, so the refusal is recorded", async () => {
    await testAStaleStepIsStillDispatched();
  });

  it("answers per step, not per alarm, on one raised_at", async () => {
    await testStalenessIsPerStepNotPerAlarm();
  });
});
