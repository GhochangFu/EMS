import { describe, it } from "vitest";

import {
  testAReofferedRaiseIsNeverAbandoned,
  testAStaleStepRecordsOneRowAndSendsNothing,
  testAStepOverTheReserveIsRefusedRatherThanAbandoned,
  testAnAlreadyAnsweredStepWritesNoStaleRow,
  testTheCeilingAnswersBeforeTheAge,
} from "./dispatch-staleness.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per case, so a mutation can be shown to redden the case that owns
 * it: S6 and S7 each fail for exactly one wrong placement of the exit.
 */
describe("F3.52 the skipped_stale exit", () => {
  it("records one row for an abandoned step and sends nothing", async () => {
    await testAStaleStepRecordsOneRowAndSendsNothing();
  });

  it("writes no stale row for a step the ledger already answered", async () => {
    await testAnAlreadyAnsweredStepWritesNoStaleRow();
  });

  it("lets the hourly ceiling answer first, so budget never ages a step out", async () => {
    await testTheCeilingAnswersBeforeTheAge();
  });

  it("abandons the step and never the re-offered raise beside it", async () => {
    await testAReofferedRaiseIsNeverAbandoned();
  });

  it("refuses a late step over the reserve rather than abandoning it", async () => {
    await testAStepOverTheReserveIsRefusedRatherThanAbandoned();
  });
});
