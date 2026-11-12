import { describe, it } from "vitest";

import {
  assertMergeDraftDoesNotClaimACredentialWhenNoKeyIsConfigured,
  assertMergeDraftFlagsTheRtuWhenAKeyIsConfigured,
  assertMergeDraftForwardsTheKeyVersionOntoTheBlob,
  assertMergeDraftReplacesAStoredCredential,
} from "./onboarding-chat-credentials.spec";

/**
 * ADR 0062 decisions 3 and 8 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014).
 */
describe("OnboardingChatService.mergeDraft — the key version and the unconfigured path (ADR 0062)", () => {
  it("forwards the loaded key version onto the stored blob", () => {
    assertMergeDraftForwardsTheKeyVersionOntoTheBlob();
  });

  it("replaces a stored credential on a second write (F4.333, ADR 0129 decision 1)", () => {
    assertMergeDraftReplacesAStoredCredential();
  });

  it("flags the owning RTU when a key is configured (positive control)", () => {
    assertMergeDraftFlagsTheRtuWhenAKeyIsConfigured();
  });

  it("does not claim a stored credential when no key is configured", () => {
    assertMergeDraftDoesNotClaimACredentialWhenNoKeyIsConfigured();
  });
});
