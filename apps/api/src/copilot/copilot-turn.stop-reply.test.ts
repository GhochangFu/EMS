import { describe, it } from "vitest";

import {
  aFollowUpOverTheCapSaysSo,
  aFollowUpOverTheOrganizationLimitSaysSo,
  aFollowUpOverTheUserLimitSaysSo,
  aFollowUpPastTheDeadlineSaysSo,
  aFollowUpProviderErrorStoresNoCause,
  aProviderErrorKeepsThePlainReply,
  aUserTurnOverTheCapSaysSo,
  aUserTurnPastTheDeadlineSaysSo,
  eachStopReasonHasItsOwnReply,
  theRepliesNameTheLoopLimits,
} from "./copilot-turn.stop-reply.spec";

/** `F4.294` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.294 — a failed copilot turn says why", () => {
  it("names the loop's own deadline and call cap in the replies", () => theRepliesNameTheLoopLimits());
  it("gives each stop reason its own reply", () => eachStopReasonHasItsOwnReply());
  it("says a user turn ran out of time", () => aUserTurnPastTheDeadlineSaysSo());
  it("says a user turn needed too many reads", () => aUserTurnOverTheCapSaysSo());
  it("keeps the plain reply for a provider error", () => aProviderErrorKeepsThePlainReply());
  it("stores that a follow-up ran out of time", () => aFollowUpPastTheDeadlineSaysSo());
  it("stores that a follow-up needed too many reads", () => aFollowUpOverTheCapSaysSo());
  it("stores no cause for a follow-up provider error", () => aFollowUpProviderErrorStoresNoCause());
  it("stores the user's daily limit on a follow-up, with no model call", () => aFollowUpOverTheUserLimitSaysSo());
  it("stores the organization's daily limit on a follow-up, with no organization", () => aFollowUpOverTheOrganizationLimitSaysSo());
});
