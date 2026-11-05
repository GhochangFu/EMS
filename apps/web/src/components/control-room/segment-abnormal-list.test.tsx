// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  anEmptyListSaysSo,
  namesEachEntryByItsAssetLabel,
  countsNormalAndNamesTheTruncation,
  offersNoActionAndNoAlarmLink,
  rendersTheBaselineLine,
  rendersTheFourVerdictSentences,
} from "./segment-abnormal-list.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 the segment abnormal list", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one sentence per verdict", () => {
    rendersTheFourVerdictSentences();
  });

  it("renders the baseline line", () => {
    rendersTheBaselineLine();
  });

  it("counts normal assets and names the truncation", () => {
    countsNormalAndNamesTheTruncation();
  });

  it("offers no action and no alarm link", () => {
    offersNoActionAndNoAlarmLink();
  });

  it("says so when no asset is outside its normal", () => {
    anEmptyListSaysSo();
  });

  it("names each entry <code> · <RTU>, or <code> · <location> without an RTU (F4.316)", () => {
    namesEachEntryByItsAssetLabel();
  });
});
