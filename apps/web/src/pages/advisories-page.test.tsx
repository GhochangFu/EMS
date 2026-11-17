// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCappedAnswerSaysSo,
  aFailedReadShowsOneSentence,
  aFilterChangeRefetchesWithTheTwoKeys,
  anEmptyAnswerSaysWhy,
  aPendingReadIsLoadingNotEmpty,
  aWholeAnswerSaysNothingOfTheCap,
  eachCardLinksItsAsset,
  theCardsRenderInTheServersOrder,
  theListIsReadEveryFifteenMinutes,
  theQueryFnIsAThunk,
  theReadWaitsForTheScope,
} from "./advisories-page.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2) — assertions live in the sibling `.spec`. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("E1.6b — the Advisories page", () => {
  it("renders the cards in the server's order under two pickers", () => theCardsRenderInTheServersOrder());
  it("passes only the filter to the read (a thunk)", () => theQueryFnIsAThunk());
  it("waits for the scope before reading", () => theReadWaitsForTheScope());
  it("says loading, not empty, while the read is pending", () => aPendingReadIsLoadingNotEmpty());
  it("says why an empty answer is empty", () => anEmptyAnswerSaysWhy());
  it("shows one fixed sentence when the read fails", () => aFailedReadShowsOneSentence());
  it("says when the meter list was capped", () => aCappedAnswerSaysSo());
  it("says nothing of the cap when the list is whole", () => aWholeAnswerSaysNothingOfTheCap());
  it("a filter change reads again with the two keys only", () => aFilterChangeRefetchesWithTheTwoKeys());
  it("reads the list again every 15 minutes", () => theListIsReadEveryFifteenMinutes());
  it("links each card's asset to its history page", () => eachCardLinksItsAsset());
});
