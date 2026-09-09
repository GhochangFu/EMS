import { describe, it } from "vitest";

import { assertMergeDraftPatchesADeepStoredDraft } from "./onboarding-chat-deep-draft.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingChatService.mergeDraft — an already-deep stored draft (F4.115)", () => {
  it("clones a 20,000-deep stored draft so the recovery patch can be applied", () => {
    assertMergeDraftPatchesADeepStoredDraft();
  });
});
