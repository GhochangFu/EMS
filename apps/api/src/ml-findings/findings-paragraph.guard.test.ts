import { describe, it } from "vitest";

import {
  eachReasonHasATextThatFailsForItAlone,
  theHardenedRulesEachRefuseTheirForm,
  factWordsNeverOpenALinkOrMarkup,
  lookAlikeCharactersAreRefused,
  moreNumberFormsAreRefused,
  theEdgeCasesThePlanNames,
  theFixturesGoodParagraphsPass,
  theGoodParagraphPasses,
} from "./findings-paragraph.guard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9c — the findings paragraph guard (ADR 0135 Amendment 8 decision 5)", () => {
  it("a good paragraph passes", () => theGoodParagraphPasses());
  it("each reason has a text that fails for it alone", () => eachReasonHasATextThatFailsForItAlone());
  it("the edge cases the plan names", () => theEdgeCasesThePlanNames());
  it("the hardened rules (M2) each refuse their form; decimals, dashes and fact words still pass", () =>
    theHardenedRulesEachRefuseTheirForm());
  it("a fact word never opens a scheme, a domain or markup (re-review 1)", () => factWordsNeverOpenALinkOrMarkup());
  it("look-alike characters are refused; the typography allow-list passes (re-review 2)", () => lookAlikeCharactersAreRefused());
  it("more number words, compositions and separators are refused (re-review 3)", () => moreNumberFormsAreRefused());
  it("the fixture's good paragraphs pass", () => theFixturesGoodParagraphsPass());
});
