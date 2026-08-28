import { describe, it } from "vitest";

import {
  runDraftStaysPermissiveTests,
  runOnboardingSchemaTests,
} from "./onboarding.schema.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding.schema", () => {
  it("accepts and rejects onboarding draft payloads", () => {
    runOnboardingSchemaTests();
  });

  it("keeps the draft subtree permissive for its stored and model producers (E7.1f)", () => {
    runDraftStaysPermissiveTests();
  });
});
