// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  linksEachAssetToItsHistory,
  namesTheMoreAssetsCount,
  namesEachAssetByItsLabel,
  theLabelCellIsNeverTruncated,
  noChangeColumnWithoutCompare,
  showsTheChangeOnlyWithACompareRow,
  sortsByMeanThenByMax,
} from "./segment-ranking-table.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 the segment ranking table", () => {
  afterEach(() => {
    cleanup();
  });

  it("sorts by mean, then by max on the toggle", () => {
    sortsByMeanThenByMax();
  });

  it("shows the change only for an asset with a previous-period row", () => {
    showsTheChangeOnlyWithACompareRow();
  });

  it("has no change column with compare off", () => {
    noChangeColumnWithoutCompare();
  });

  it("names the assets past the cap as a count", () => {
    namesTheMoreAssetsCount();
  });

  it("links each asset to its history over the exact window", () => {
    linksEachAssetToItsHistory();
  });

  it("names each asset <code> · <RTU>, or <code> · <location> without an RTU (F4.316)", () => {
    namesEachAssetByItsLabel();
  });

  it("never truncates the asset label cell (F4.316)", () => {
    theLabelCellIsNeverTruncated();
  });
});
