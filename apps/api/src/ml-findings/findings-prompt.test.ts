import { describe, it } from "vitest";

import {
  thePromptHoldsNoFixtureNameAndNoUuid,
  theSystemTextHoldsEachRule,
  theUserTextIsExactlyTheKindAndTheLines,
} from "./findings-prompt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — the findings prompt (ADR 0135 Amendment 8)", () => {
  it("the system text holds each rule", () => theSystemTextHoldsEachRule());
  it("the user text is exactly the kind and the lines", () => theUserTextIsExactlyTheKindAndTheLines());
  it("the prompt holds no fixture name and no UUID", () => thePromptHoldsNoFixtureNameAndNoUuid());
});
