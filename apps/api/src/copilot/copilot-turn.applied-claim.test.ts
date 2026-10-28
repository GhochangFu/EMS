import { describe, it } from "vitest";

import {
  aClaimAfterARealConfirmIsUntouched,
  aFollowUpAppliedClaimIsUntouched,
  aTypedConfirmIsNotAnApply,
  theAwsCardReplyIsNoted,
  thePromptCarriesTheAppliedRule,
} from "./copilot-turn.applied-claim.spec";

/** `F4.293` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.293 — a copilot reply never claims a change was applied, or a card is up, that nothing produced", () => {
  it("appends, returns and stores the applied note after a typed confirm", () => aTypedConfirmIsNotAnApply());
  it("leaves an applied claim untouched after a real Confirm", () => aClaimAfterARealConfirmIsUntouched());
  it("leaves an applied claim on a follow-up turn untouched", () => aFollowUpAppliedClaimIsUntouched());
  it("notes the AWS card reply that proposed nothing", () => theAwsCardReplyIsNoted());
  it("carries the typed-confirm rule in the system prompt", () => thePromptCarriesTheAppliedRule());
});
