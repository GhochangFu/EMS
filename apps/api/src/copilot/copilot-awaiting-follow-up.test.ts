import { describe, it } from "vitest";

import {
  aChangeWithNoLineIsAwaited,
  aLineInTheSameMillisecondEndsTheWait,
  anOlderLineDoesNotEndTheWait,
  anotherChangesLineDoesNotEndTheWait,
  anUnreadableTimeDoesNotEndTheWait,
  aUserLineDoesNotEndTheWait,
  itsOutcomeLineAfterItFinishedEndsTheWait,
  noFinishedChangeIsNoWait,
  theProducedAppliedLineIsAnOutcome,
  theProducedFailedLineIsAnOutcome,
} from "./copilot-awaiting-follow-up.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.244 — awaitingFollowUp, the follow-up the dock waits for", () => {
  it("is null with no finished change", () => noFinishedChangeIsNoWait());
  it("names a finished change whose outcome line is not stored", () => aChangeWithNoLineIsAwaited());
  it("is null once the change's outcome line is stored after it finished", () => itsOutcomeLineAfterItFinishedEndsTheWait());
  it("is null for a line stored in the same millisecond", () => aLineInTheSameMillisecondEndsTheWait());
  it("does not end on the same text stored before the change finished", () => anOlderLineDoesNotEndTheWait());
  it("does not end on a user line", () => aUserLineDoesNotEndTheWait());
  it("does not end on another change's outcome line (review C1)", () => anotherChangesLineDoesNotEndTheWait());
  it("does not end on a line with an unreadable time", () => anUnreadableTimeDoesNotEndTheWait());
  it("binds the produced Applied line to isCopilotOutcomeLine", () => theProducedAppliedLineIsAnOutcome());
  it("binds the produced Failed line to isCopilotOutcomeLine", () => theProducedFailedLineIsAnOutcome());
});
