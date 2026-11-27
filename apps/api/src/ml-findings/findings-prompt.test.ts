import { describe, it } from "vitest";

import {
  theOldRulesAreKeptWordForWord,
  thePromptHoldsNoFixtureNameAndNoUuid,
  theSystemTextHoldsEachRule,
  theUserTextIsExactlyTheKindAndTheLines,
  theVersionMovesWithTheText,
} from "./findings-prompt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — the findings prompt (ADR 0135 Amendment 8)", () => {
  it("the system text holds each rule", () => theSystemTextHoldsEachRule());
  it("the user text is exactly the kind and the lines", () => theUserTextIsExactlyTheKindAndTheLines());
  it("the prompt holds no fixture name and no UUID", () => thePromptHoldsNoFixtureNameAndNoUuid());
  it("E1.9g version 2 keeps the ten old lines word for word, the new one after the paragraph rule", () =>
    theOldRulesAreKeptWordForWord());
  it("E1.9g the version is 2 and the prompt text is pinned by its SHA-256", () => theVersionMovesWithTheText());
});
