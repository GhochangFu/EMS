import { describe, it } from "vitest";

import {
  aCardWithNothingToSayIsNoneWithNoCall,
  aCachedParagraphIsNotServedWithTheSwitchOff,
  aLostWriteBacksOffAndStillCounts,
  noPendingWhenNoCallWillBeMade,
  aFailedRowIsRetriedOnlyAfter30Minutes,
  aFifthKeyWithFourInFlightIsPendingWithNoCall,
  aGoodReplyIsStoredOkAndServedWithItsAssetReference,
  aProviderThatNeverAnswersTimesOutAt15Seconds,
  aRefusedReplyIsRejectedWithItsReason,
  aStoreFailureNeverReachesTheRequest,
  aThrowIsFailedWithTheReasonOfItsStatus,
  oneKeyMakesOneCallWhileItHangs,
  theCallSendsNoToolsTwoMessagesAndNoName,
  theGatesAnswerNoneWithNoCallAndNoRow,
  theLogLineHoldsTheReasonKindAndOrganizationOnly,
  twoOrganizationsMakeTwoCallsEachWithItsOwnFacts,
} from "./findings-paragraph.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — the findings paragraph service (ADR 0135 Amendment 8)", () => {
  it("a good reply is stored ok and served with its asset reference", () => aGoodReplyIsStoredOkAndServedWithItsAssetReference());
  it("a refused reply is rejected with its reason, and never tried again", () => aRefusedReplyIsRejectedWithItsReason());
  it("a throw is failed with the reason of its status, never its message", () => aThrowIsFailedWithTheReasonOfItsStatus());
  it("a provider that never answers times out at 15 s", () => aProviderThatNeverAnswersTimesOutAt15Seconds());
  it("switch off, guided and the cap answer none with no call and no row", () => theGatesAnswerNoneWithNoCallAndNoRow());
  it("a failed row is retried only after 30 minutes, with attempts + 1; a rejected row never", () => aFailedRowIsRetriedOnlyAfter30Minutes());
  it("one key makes one call while it hangs", () => oneKeyMakesOneCallWhileItHangs());
  it("a fifth key with four in flight is pending with no call", () => aFifthKeyWithFourInFlightIsPendingWithNoCall());
  it("two organizations make two calls, each with its own facts", () => twoOrganizationsMakeTwoCallsEachWithItsOwnFacts());
  it("a card with nothing to say is none with no call", () => aCardWithNothingToSayIsNoneWithNoCall());
  it("the call sends no tools, two messages and no name or UUID", () => theCallSendsNoToolsTwoMessagesAndNoName());
  it("the log line holds the reason, the kind and the organization id only", () =>
    theLogLineHoldsTheReasonKindAndOrganizationOnly());
  it("a store failure never reaches the request and logs no message", () => aStoreFailureNeverReachesTheRequest());
  it("a cached paragraph is not served with the switch off", () => aCachedParagraphIsNotServedWithTheSwitchOff());
  it("no pending when no call will be made (no reservation before the gates)", () => noPendingWhenNoCallWillBeMade());
  it("a lost write backs off for 30 minutes and still counts against the cap", () => aLostWriteBacksOffAndStillCounts());
});
