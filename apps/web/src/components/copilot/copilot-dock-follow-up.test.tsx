// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aReadInFlightAtASkillOnlyTurnKeepsTheSkill,
  aReadInFlightAtTheConfirmDoesNotDropTheWait,
  aReadInFlightAtTheRejectDoesNotRestoreTheCard,
  aRemountBeforeTheFirstPollKeepsTheWait,
  aRouteFailureSeedsTheWaitToo,
  aTurnAfterAFocusReadShowsEachRowOnce,
  doesNotHoldSendForAWaitOlderThanTheWindow,
  dropsAStoredConversationTheServerNoLongerHas,
  keepsTheStoredConversationOnAServerError,
  pollsUntilTheResumedFollowUpLands,
  resumesTheWaitFromAnAwaitedChangeOnMount,
  showsNotAppliedForAResumedFailedChange,
} from "./copilot-dock-follow-up.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment jsdom` docblock is on THIS file (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetCopilotStore();
  window.localStorage.clear();
  focusManager.setFocused(undefined);
});

describe("F4.244 copilot dock — the follow-up wait resumes", () => {
  it("resumes the wait from an awaited change on mount", resumesTheWaitFromAnAwaitedChangeOnMount);
  it("shows Not applied for a resumed failed change", showsNotAppliedForAResumedFailedChange);
  it("polls until the resumed follow-up lands, then stops", pollsUntilTheResumedFollowUpLands);
  it("holds nothing for a follow-up older than the wait", doesNotHoldSendForAWaitOlderThanTheWindow);
  it("keeps the wait on a remount before the first poll", aRemountBeforeTheFirstPollKeepsTheWait);
  it("seeds the wait after a route's refusal too", aRouteFailureSeedsTheWaitToo);
  it("keeps the seed when a read in flight at the Confirm answers late (review C4)", aReadInFlightAtTheConfirmDoesNotDropTheWait);
  it("shows each row once when a focus read answered before the turn's response", aTurnAfterAFocusReadShowsEachRowOnce);
  it("does not restore a rejected card from a read in flight at the Reject", aReadInFlightAtTheRejectDoesNotRestoreTheCard);
  it("keeps a skill-only turn's skill state from a read in flight at the turn", aReadInFlightAtASkillOnlyTurnKeepsTheSkill);
  it("drops a stored conversation the server no longer has", dropsAStoredConversationTheServerNoLongerHas);
  it("keeps the stored conversation on a server error", keepsTheStoredConversationOnAServerError);
});
