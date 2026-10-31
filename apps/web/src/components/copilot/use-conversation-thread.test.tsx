// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedOutcomeLineEndsTheWait,
  aFocusReReadsTheThreadWhenNoWaitIsOn,
  aLocalWriteAfterATimedOutWaitDoesNotReArm,
  anEarlierOutcomeLineDoesNotEndTheWait,
  anotherChangesOutcomeLineDoesNotEndTheWait,
  armsFromTheLocalStartNotFromTheMount,
  failsClosedOnAnUnreadableAge,
  resetsTheWaitWhenTheConversationChanges,
  anOutcomeLineInALaterPageEndsTheWait,
  theThreadReadsTheNewestPage,
} from "./use-conversation-thread.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
describe("F4.244 useConversationThread — the follow-up wait", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    focusManager.setFocused(undefined);
  });

  it("arms from the local start written with the answer, not from the mount", () => armsFromTheLocalStartNotFromTheMount());
  it("holds nothing on an unreadable age", () => failsClosedOnAnUnreadableAge());
  it("does not re-arm on a local write after a timed-out wait (review C2)", () => aLocalWriteAfterATimedOutWaitDoesNotReArm());
  it("drops the wait when the conversation changes", () => resetsTheWaitWhenTheConversationChanges());
  it("ends the wait on a Failed outcome line", () => aFailedOutcomeLineEndsTheWait());
  it("does not end the wait on another change's outcome line (review C1)", () => anotherChangesOutcomeLineDoesNotEndTheWait());
  it("does not end the wait on an outcome line held before it began", () => anEarlierOutcomeLineDoesNotEndTheWait());
  it("re-reads the thread on a window focus when no wait is on (review C3)", () => aFocusReReadsTheThreadWhenNoWaitIsOn());
  it("reads the newest page (F4.292)", () => theThreadReadsTheNewestPage());
  it("ends the wait on an outcome line in a later page (F4.292 critic)", () => anOutcomeLineInALaterPageEndsTheWait());
});
