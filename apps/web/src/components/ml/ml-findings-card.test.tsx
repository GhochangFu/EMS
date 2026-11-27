// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  aFailedReadIsOneMutedSentence,
  aMalformedParagraphDrawsTheFactsOnly,
  aNewScopeStartsItsCountAtZero,
  anErrorAfterPendingStopsTheQuickAsks,
  aSummaryWithNothingHidesTheOldParagraph,
  aPendingReadSaysLoading,
  assetReferencesLinkOnlyToSafeHrefs,
  compactPrefersTheParagraph,
  compactShowsTheTopLinesAndThePageLinks,
  disabledMakesNoRequest,
  eachFactLineReadsItsText,
  noAlarmColourInTheSection,
  noAlarmColourWithTheParagraph,
  noCardsDrawsNothing,
  noneOrPendingOrFailureAddsNothing,
  noParagraphRequestWhenOffOrEmpty,
  paragraphReferencesUseTheParagraphsOwnAssets,
  pendingAsksAgainAtMostSixTimes,
  pendingThenOkShowsAndStops,
  stubNoParagraph,
  theFactsDoNotWaitForTheParagraph,
  theLabelShowsOnlyForOk,
  twoCardsInTheApisOrder,
  twoKindsNameTheirKind,
  twoKindsPendingNamesTheKind,
} from "./ml-findings-card.spec";

function reset(): void {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
}

/** `E1.9b` — the findings card. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9b MlFindingsCard", () => {
  beforeEach(() => stubNoParagraph());
  afterEach(() => reset());
  it("draws two cards in the API's order with the heading and the pill", () => twoCardsInTheApisOrder());
  it("reads each fact line with its assets put back", () => eachFactLineReadsItsText());
  it("links a named asset only to a safe href, and draws no listed-only asset", () =>
    assetReferencesLinkOnlyToSafeHrefs());
  it("uses no alarm or severity colour", () => noAlarmColourInTheSection());
  it("says loading while the read is pending", () => aPendingReadSaysLoading());
  it("says one muted sentence when the read fails", () => aFailedReadIsOneMutedSentence());
  it("makes no request when disabled", () => disabledMakesNoRequest());
  it("draws nothing when there are no cards", () => noCardsDrawsNothing());
  it("names the kind on each card and in a failed line when two kinds show", () => twoKindsNameTheirKind());
  it("names the kind in a pending line when two kinds show", () => twoKindsPendingNamesTheKind());
});

/** `E1.9d` — the AI paragraph slot and the compact card. */
describe("E1.9d MlFindingsCard paragraph", () => {
  beforeEach(() => stubNoParagraph());
  afterEach(() => reset());
  it("shows the AI summary box only for ok, above the facts", () => theLabelShowsOnlyForOk());
  it("adds nothing for none, pending, an empty ok, a failed read or no entry", () => noneOrPendingOrFailureAddsNothing());
  it("draws the facts before the paragraph answers", () => theFactsDoNotWaitForTheParagraph());
  it("puts a paragraph reference back from the paragraph card's own assets", () => paragraphReferencesUseTheParagraphsOwnAssets());
  it("asks for no paragraph when it is off or every card is empty", () => noParagraphRequestWhenOffOrEmpty());
  it("asks again every 4 s while pending, at most 6 times", () => pendingAsksAgainAtMostSixTimes());
  it("shows the paragraph and stops asking once it is written", () => pendingThenOkShowsAndStops());
  it("compact shows F5 and A2 lines and the two page links", () => compactShowsTheTopLinesAndThePageLinks());
  it("compact prefers the paragraph to the top lines", () => compactPrefersTheParagraph());
  it("uses no alarm colour with the paragraph or in compact", () => noAlarmColourWithTheParagraph());
});

/** `E1.9d` review fixes. */
describe("E1.9d MlFindingsCard review fixes", () => {
  beforeEach(() => stubNoParagraph());
  afterEach(() => reset());
  it("stops the quick asks once the read fails after a pending answer", () => anErrorAfterPendingStopsTheQuickAsks());
  it("starts a new scope's count at zero", () => aNewScopeStartsItsCountAtZero());
  it("hides an old paragraph when the summary now has nothing", () => aSummaryWithNothingHidesTheOldParagraph());
  it("draws the facts only for a malformed paragraph card", () => aMalformedParagraphDrawsTheFactsOnly());
});
