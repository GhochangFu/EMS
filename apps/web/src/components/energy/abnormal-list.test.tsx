// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aShortHistoryRowSaysNotEnoughHistory,
  aSiteRowCarriesNoLabel,
  anAssetRowShowsItsLabel,
  anAssetRowWithNoRtuShowsItsLocation,
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

describe("F4.316 PR 6 — the abnormal list names an asset by its label (ADR 0111)", () => {
  it("an asset row under an RTU shows <code> · <RTU>", () => {
    anAssetRowShowsItsLabel();
  });
  it("an asset row with no RTU shows <code> · <location>", () => {
    anAssetRowWithNoRtuShowsItsLocation();
  });
  it("a site row carries no label", () => {
    aSiteRowCarriesNoLabel();
  });
});
