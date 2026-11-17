import { describe, it } from "vitest";

import {
  compactLinesPicksTheTopLines,
  mlPageHrefCarriesOrganizationAndLocation,
  onlyACardWithFindingsIsWorthAParagraph,
  paragraphPollMsIsBounded,
  pickScopeKeepsTheKeysAskedFor,
  resolveSegmentsPutsTheAssetsBack,
  safeAssetHrefAllowsOnlyTheHistoryPage,
  scopeKeyIsStable,
  splitSentencesCutsAtASentenceEnd,
  splitSentencesKeepsEveryWord,
  splitSentencesNeverCutsInsideAWordOrANumber,
  splitSentencesTreatsAnAssetAsOneUnit,
  summaryOfKeepsTheWeakSentence,
  summaryOfTakesAHeadlineAndCappedPoints,
  theF5TooltipIsFixed,
  theBaselineWordMatchesTheWeb,
} from "./ml-findings.spec";

/** `E1.9b` — the findings helpers. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9b ml findings helpers", () => {
  it("pickScope keeps the keys asked for", () => pickScopeKeepsTheKeysAskedFor());
  it("scopeKey is one stable string per scope", () => scopeKeyIsStable());
  it("safeAssetHref allows only the asset history page", () => safeAssetHrefAllowsOnlyTheHistoryPage());
  it("resolveSegments puts the assets back, and an unknown one is text", () => resolveSegmentsPutsTheAssetsBack());
  it("the F5 tooltip is fixed", () => theF5TooltipIsFixed());
  it("the A4 sentences' detector word is the web's", () => theBaselineWordMatchesTheWeb());
  it("E1.9d paragraphPollMs asks every 4 s while pending, at most 6 times", () => paragraphPollMsIsBounded());
  it("E1.9d compactLines picks A2 over A1 and F5 over F1", () => compactLinesPicksTheTopLines());
  it("E1.9d mlPageHref carries the organization and the location", () => mlPageHrefCarriesOrganizationAndLocation());
  it("E1.9d only a card with findings is worth a paragraph", () => onlyACardWithFindingsIsWorthAParagraph());
  it("E1.9g splitSentences cuts at . ! ? + space + capital or [", () => splitSentencesCutsAtASentenceEnd());
  it("E1.9g splitSentences never cuts before a lower-case letter or a digit", () =>
    splitSentencesNeverCutsInsideAWordOrANumber());
  it("E1.9g splitSentences treats an asset part as one unit, never scanned", () => splitSentencesTreatsAnAssetAsOneUnit());
  it("E1.9g splitSentences keeps every word but the spaces at a cut", () => splitSentencesKeepsEveryWord());
  it("E1.9g summaryOf: a headline, then at most 4 (or 2) points", () => summaryOfTakesAHeadlineAndCappedPoints());
  it("E1.9g summaryOf: a hidden sentence that alone holds 'weak' takes the last point slot (OQ-1 a)", () =>
    summaryOfKeepsTheWeakSentence());
});
