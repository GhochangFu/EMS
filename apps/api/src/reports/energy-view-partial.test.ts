import { describe, it } from "vitest";

import {
  assertAFullyReadableSelectionCountsEqual,
  assertAGlobalReaderHasNoPartial,
  assertARepeatedSiteCountsOnce,
  assertTheAnswerCarriesOnlyTheTwoCounts,
  assertTheCountsAreTheReadablePartOfTheSelection,
} from "./energy-view-partial.spec";

describe("energy view partial coverage (F4.298 U2, ADR 0108 decision 2.9)", () => {
  it("a null readable list gives no partial", assertAGlobalReaderHasNoPartial);
  it("the counts are the readable part of the selection", assertTheCountsAreTheReadablePartOfTheSelection);
  it("the answer carries only readableSites and selectedSites", assertTheAnswerCarriesOnlyTheTwoCounts);
  it("a repeated site counts once", assertARepeatedSiteCountsOnce);
  it("a fully readable selection gives equal counts", assertAFullyReadableSelectionCountsEqual);
});
