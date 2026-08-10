import { describe, it } from "vitest";

import { runCredentialDetectTests } from "./onboarding-credential-detect.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding credential detection", () => {
  it("refuses turns carrying secrets without breaking wizard vocabulary", () => {
    runCredentialDetectTests();
  });
});
