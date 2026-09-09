import { describe, it } from "vitest";

import {
  assertAttachEncryptedCredentialsReadsADeepDraft,
  assertRedactDraftForClientReadsADeepDraft,
  assertScrubSecretsKeepsKeyOrderAndProtoKey,
  runOnboardingRedactionTests,
} from "./onboarding-redaction.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding-redaction", () => {
  it("strips secrets before onboarding payloads leave the process", () => {
    runOnboardingRedactionTests();
  });
});

/**
 * `F4.115` ruling 2b. One `it()` per claim, and deliberately **not** appended to
 * `runOnboardingRedactionTests` above: that function is a single `it()` over
 * dozens of `assert` calls, so any mutation kills it at the first one and
 * proves nothing about a claim written after it.
 */
describe("onboarding-redaction — an already-deep stored draft (F4.115)", () => {
  it("reads a 20,000-deep stored draft and redacts to the bottom of it", () => {
    assertRedactDraftForClientReadsADeepDraft();
  });

  it("attaches a credential to a 20,000-deep stored draft", () => {
    assertAttachEncryptedCredentialsReadsADeepDraft();
  });

  it("keeps key order and an own __proto__ through the scrub", () => {
    assertScrubSecretsKeepsKeyOrderAndProtoKey();
  });
});
