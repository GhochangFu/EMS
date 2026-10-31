import { describe, it } from "vitest";

import {
  aClaimAfterARealConfirmIsUntouched,
  aFailedFollowUpClaimIsNoted,
  anOpenCardKeepsTheNote,
  aRejectedCardDoesNotCoverATypedConfirm,
  anEarlierConfirmDoesNotCoverALaterTypedConfirm,
  aFollowUpAppliedClaimIsUntouched,
  aTypedConfirmIsNotAnApply,
  theAwsCardReplyIsNoted,
  thePromptCarriesTheAppliedRule,
} from "./copilot-turn.applied-claim.spec";

/** `F4.293` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.293 — a copilot reply never claims a change was applied, or a card is up, that nothing produced", () => {
  it("appends, returns and stores the applied note after a typed confirm", () => aTypedConfirmIsNotAnApply());
  it("leaves an applied claim untouched after a real Confirm", () => aClaimAfterARealConfirmIsUntouched());
  it("notes a typed confirm that follows a new request, even after an earlier real Confirm", () => anEarlierConfirmDoesNotCoverALaterTypedConfirm());
  it("leaves an applied claim on a follow-up turn untouched", () => aFollowUpAppliedClaimIsUntouched());
  it("notes a typed confirm after a rejected card", () => aRejectedCardDoesNotCoverATypedConfirm());
  it("notes a typed confirm while the next card is still open", () => anOpenCardKeepsTheNote());
  it("notes an applied claim on a follow-up for a failed change", () => aFailedFollowUpClaimIsNoted());
  it("notes the AWS card reply that proposed nothing", () => theAwsCardReplyIsNoted());
  it("carries the typed-confirm rule in the system prompt", () => thePromptCarriesTheAppliedRule());
});
