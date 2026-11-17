import { describe, it } from "vitest";

import {
  runConstantsTest,
  runEvidenceCapTest,
  runExactKeySetsTest,
  runFourCandidatesRefusedTest,
  runFullAnswerParsesTest,
  runNotStrictTest,
  runNullableQuoteAndOccurrencesTest,
  runPointKeyBoundTest,
  runStrengthIsAClosedWordTest,
  runUnknownRuleRefusedTest,
} from "./alarm-root-cause.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.3 — the root-cause suggestions contract (ADR 0136)", () => {
  it("the cap, the look-back, and the closed rule, strength and evidence-kind sets", () => runConstantsTest());
  it("a full answer parses, and so does an empty one", () => runFullAnswerParsesTest());
  it("four candidates are refused (the cap is 3)", () => runFourCandidatesRefusedTest());
  it("a strength of 'high' or a number is refused; the three words parse", () => runStrengthIsAClosedWordTest());
  it("an unknown rule or evidence kind is refused", () => runUnknownRuleRefusedTest());
  it("an unknown extra key parses (responses are not strict)", () => runNotStrictTest());
  it("quote: null and occurrences: null parse; a long quote is never refused", () =>
    runNullableQuoteAndOccurrencesTest());
  it("a 129-character contributing point key is refused", () => runPointKeyBoundTest());
  it("a candidate holds at most 5 evidence items", () => runEvidenceCapTest());
  it("the key sets are exact: no score, no percentage, no user field", () => runExactKeySetsTest());
});
