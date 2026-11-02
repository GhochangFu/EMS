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
