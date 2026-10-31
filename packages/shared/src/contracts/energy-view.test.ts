import { describe, it } from "vitest";

import * as spec from "./energy-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.298 — the energy view contract (ADR 0108 decision 2, ADR 0030)", () => {
  it("parses range=today alone", () => spec.assertTodayAloneParses());
  it("folds one bare locationIds into a list", () => spec.assertABareLocationIdFoldsIntoAList());
  it("keeps a repeated locationIds list", () => spec.assertARepeatedLocationIdListParses());
  it("refuses an unknown query key (strict)", () => spec.assertAnUnknownKeyIsRefused());
  it("refuses compare=next", () => spec.assertCompareNextIsRefused());
  it("refuses a non-uuid organizationId", () => spec.assertANonUuidOrganizationIdIsRefused());
  it("accepts the seven ranges and refuses another", () => spec.assertAnUnknownRangeIsRefused());
  it("parses a response with compare: null and partial: null", () => spec.assertTheResponseWithNullCompareAndPartialParses());
  it("parses a response with a compare period and a partial note", () => spec.assertTheResponseWithCompareAndPartialParses());
  it("refuses an id list in partial (counts only)", () => spec.assertPartialCarriesCountsOnly());
  it("refuses a level outside the ladder", () => spec.assertAnUnknownLevelIsRefused());
  it("declares the aggregate level enum as the 1m/5m/1h/1d ladder", () => spec.assertTheLevelEnumIsTheLadder());
  it("parses the filter options", () => spec.assertTheFilterOptionsParse());
});
