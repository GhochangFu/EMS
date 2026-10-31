import { describe, it } from "vitest";

import {
  assertAZeroTotalSplitsToZero,
  assertDgIsFourPercentOfTheNetLoad,
  assertNoSolarLeavesTheWholeTotalAsNet,
  assertSolarAboveTheTotalLeavesNoDgAndNoGrid,
  assertTheSplitIsNotRounded,
  assertTheThreePartsAddUpToTheTotal,
} from "./energy-sources.spec";

describe("nominalSourceSplit (F4.298 U3, ADR 0108 decision 2.10)", () => {
  it("DG is 4 % of the net load and grid the rest", assertDgIsFourPercentOfTheNetLoad);
  it("no solar leaves the whole total as net", assertNoSolarLeavesTheWholeTotalAsNet);
  it("solar above the total leaves no DG and no grid", assertSolarAboveTheTotalLeavesNoDgAndNoGrid);
  it("a zero total splits to zero", assertAZeroTotalSplitsToZero);
  it("solar, DG and grid add up to the total", assertTheThreePartsAddUpToTheTotal);
  it("the split is not rounded", assertTheSplitIsNotRounded);
});
