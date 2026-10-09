import { describe, it } from "vitest";

import * as spec from "./asset-kpis.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.33 — the asset KPI response contract (ADR 0097, ADR 0030)", () => {
  it("parses a full response", () => spec.assertFullItemParses());
  it("refuses an item carrying a member id list (decision 6)", () => spec.assertExtraKeyIsRefused());
  it("refuses an item carrying the expression (decision 6, owner ruling)", () => spec.assertExpressionIsRefused());
  it("does not list coverage_below_floor as a state", () => spec.assertCoverageBelowFloorIsNotAState());
  it("lists windows_unresolved as a state", () => spec.assertWindowsUnresolvedIsAState());
  it("parses inputAsOf as null or an offset ISO string", () => spec.assertInputAsOfNullAndOffsetParse());
  it("refuses a bare date as inputAsOf", () => spec.assertBareDateIsRefused());
  it("leaves the value/state pairing to the host", () => spec.assertNullValueWithOkParsesAtSchemaLevel());
  it("makes unit and higherIsBetter optional", () => spec.assertOptionalFieldsMayBeAbsent());
});
