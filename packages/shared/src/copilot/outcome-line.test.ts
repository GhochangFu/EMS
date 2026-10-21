import { describe, it } from "vitest";

import { aFailedLineIsAnOutcome, anAppliedLineIsAnOutcome, aRejectedLineIsNotAnOutcome } from "./outcome-line.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.244 — isCopilotOutcomeLine, the follow-up's outcome line", () => {
  it("takes an Applied line as an outcome", () => anAppliedLineIsAnOutcome());
  it("takes a Failed line as an outcome", () => aFailedLineIsAnOutcome());
  it("does not take a Rejected line as an outcome", () => aRejectedLineIsNotAnOutcome());
});
