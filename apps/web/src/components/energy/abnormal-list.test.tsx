// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aShortHistoryRowSaysNotEnoughHistory,
  aTruncatedListSaysSo,
  aWholeListHasNoTruncationLine,
  anAboveRowShowsTheRatio,
  theExplanationIsTheBaselineSentence,
  theFooterCountsTheNormalEntities,
  theListOffersNoActionAndNoAlarmLink,
} from "./abnormal-list.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
afterEach(() => {
  cleanup();
});

describe("F4.299 abnormal list", () => {
  it("shows the ratio on an above row", () => {
    anAboveRowShowsTheRatio();
  });
  it("says not enough history on a short-history row", () => {
    aShortHistoryRowSaysNotEnoughHistory();
  });
  it("counts the normal sites and assets in the footer", () => {
    theFooterCountsTheNormalEntities();
  });
  it("explains the baseline in one sentence", () => {
    theExplanationIsTheBaselineSentence();
  });
  it("says a truncated list is truncated", () => {
    aTruncatedListSaysSo();
  });
  it("has no truncation line for a whole list", () => {
    aWholeListHasNoTruncationLine();
  });
  it("offers no button and no link", () => {
    theListOffersNoActionAndNoAlarmLink();
  });
});
