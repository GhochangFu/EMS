import { describe, it } from "vitest";

import {
  assert2001CoilsSplitAt2000,
  assertA126WordRunSplitsAt125,
  assertAdjacentHoldingRegistersCoalesce,
  assertAFloat64StraddlingTheLimitMovesWhole,
  assertAOneAddressGapSplits,
  assertEmptySourceKeysPlansAll,
  assertNoRegistersPlanNothing,
  assertOffsetsAreCorrectForMixedWidths,
  assertOnlyKeysInSourceKeysArePlanned,
  assertOverlappingRegistersShareABlock,
  assertTwoTablesNeverShareABlock,
} from "./modbus-read-plan.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — Modbus read plan (ADR 0141 decision 8)", () => {
  it("R1 no registers plan nothing", () => assertNoRegistersPlanNothing());
  it("R2 adjacent holding registers coalesce", () =>
    assertAdjacentHoldingRegistersCoalesce());
  it("R3 a one-address gap splits", () => assertAOneAddressGapSplits());
  it("R4 two tables never share a block", () =>
    assertTwoTablesNeverShareABlock());
  it("R5 a 126-word run splits at 125", () => assertA126WordRunSplitsAt125());
  it("R6 2,001 coils split at 2,000", () => assert2001CoilsSplitAt2000());
  it("R7 a float64 straddling the 125 limit moves whole to the next block", () =>
    assertAFloat64StraddlingTheLimitMovesWhole());
  it("R8 only keys in sourceKeys are planned", () =>
    assertOnlyKeysInSourceKeysArePlanned());
  it("R9 an empty sourceKeys plans every register", () =>
    assertEmptySourceKeysPlansAll());
  it("R10 overlapping registers share a block with correct offsets", () =>
    assertOverlappingRegistersShareABlock());
  it("R11 offsets are correct for mixed widths", () =>
    assertOffsetsAreCorrectForMixedWidths());
});
