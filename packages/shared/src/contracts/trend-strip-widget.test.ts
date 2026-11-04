import { describe, it } from "vitest";

import * as spec from "./trend-strip-widget.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.305 — the trend_strip widget config (ADR 0108 Amendment 3)", () => {
  it("is 4 grid rows tall", () => spec.assertTheWidgetIsFourRowsTall());
  it("is a plain ZodObject", () => spec.assertTheConfigIsAPlainObject());
  it("refuses an empty config", () => spec.assertAnEmptyConfigFails());
  it("parses each range and an optional tabKey", () => spec.assertEachRangeAndAnOptionalTabKeyParse());
  it("offers the same ranges as the strip query", () => spec.assertTheRangesEqualTheStripQueryRanges());
  it("refuses an unknown range and a malformed tabKey", () => spec.assertAnUnknownRangeOrKeyFails());
});

describe("F4.306 — the trend_strip selection (ADR 0108 Amendment 7)", () => {
  it("parses each selection field alone and all three", () => spec.assertEachSelectionFieldAloneAndAllThreeParse());
  it("names the eight series roles", () => spec.assertTheEightSeriesRoles());
  it("refuses an undeclared config key on write", () => spec.assertAnUnknownSelectionKeyIsRefusedOnWrite());
  it("refuses a 31st point", () => spec.assertAThirtyFirstPointIsRefused());
  it("refuses a 31st segment", () => spec.assertThirtyOneSegmentsAreRefused());
  it("refuses an empty segments list", () => spec.assertAnEmptySegmentsListIsRefused());
  it("refuses an empty points list", () => spec.assertAnEmptyPointsListIsRefused());
  it("refuses a point that is not domain:code", () => spec.assertAMalformedPointIsRefused());
  it("builds the point pattern from the catalog code pattern", () =>
    spec.assertTheCodePatternIsTheCatalogPattern());
  it("refuses a colour outside the series roles", () => spec.assertAColourOutsideTheSeriesRolesIsRefused());
  it("round-trips the stock strips byte-equal", () => spec.assertTheStockStripsRoundTripByteEqual());
  it("fills the series cap with 30 points of 6 assets", () =>
    spec.assertThirtyPointsOfSixAssetsFillTheSeriesCap());
});
