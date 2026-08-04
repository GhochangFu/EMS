import { describe, it } from "vitest";

import { runOnboardingRedactionTests } from "./onboarding-redaction.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding-redaction", () => {
  it("strips secrets before onboarding payloads leave the process", () => {
    runOnboardingRedactionTests();
  });
});
