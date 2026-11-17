import { describe, it } from "vitest";

import {
  eachReasonHasATextThatFailsForItAlone,
  theEdgeCasesThePlanNames,
  theFixturesGoodParagraphsPass,
  theGoodParagraphPasses,
} from "./findings-paragraph.guard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — the findings paragraph guard (ADR 0135 Amendment 8 decision 5)", () => {
  it("a good paragraph passes", () => theGoodParagraphPasses());
  it("each reason has a text that fails for it alone", () => eachReasonHasATextThatFailsForItAlone());
  it("the edge cases the plan names", () => theEdgeCasesThePlanNames());
  it("the fixture's good paragraphs pass", () => theFixturesGoodParagraphsPass());
});
