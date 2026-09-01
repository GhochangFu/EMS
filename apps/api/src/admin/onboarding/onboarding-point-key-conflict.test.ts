import { describe, it } from "vitest";

import { runOnboardingPointKeyConflictTests } from "./onboarding-point-key-conflict.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding-point-key-conflict", () => {
  it("refuses a draft declaration that contradicts the fleet-wide catalog row", () => {
    runOnboardingPointKeyConflictTests();
  });
});
