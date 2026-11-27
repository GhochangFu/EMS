import { describe, it } from "vitest";

import {
  aFillIsTheQuoteOrTheTitle,
  aLongQuoteIsCutToTheFieldLimit,
  eachHeading,
  holdsTextIsANonBlankString,
  theClassCauseGivesNoFillText,
  theContextSentenceIsAdvisory,
  theEvidenceLines,
  theStrengthWords,
} from "./root-cause-suggestions.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.3 — the root-cause suggestion words (ADR 0136 decision 6)", () => {
  it("each candidate's heading", () => eachHeading());
  it("the strength words", () => theStrengthWords());
  it("R5 gives no fill text", () => theClassCauseGivesNoFillText());
  it("a fill is the quote alone, or the title", () => aFillIsTheQuoteOrTheTitle());
  it("a 2,500-character quote is cut to 2000", () => aLongQuoteIsCutToTheFieldLimit());
  it("only a non-blank string holds text", () => holdsTextIsANonBlankString());
  it("each evidence kind's line", () => theEvidenceLines());
  it("the context sentence holds the word advisory", () => theContextSentenceIsAdvisory());
});
