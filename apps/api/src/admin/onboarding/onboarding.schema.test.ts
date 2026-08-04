import { describe, it } from "vitest";

import { runOnboardingSchemaTests } from "./onboarding.schema.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding.schema", () => {
  it("accepts and rejects onboarding draft payloads", () => {
    runOnboardingSchemaTests();
  });
});
