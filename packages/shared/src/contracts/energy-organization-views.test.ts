import { describe, it } from "vitest";

import * as spec from "./energy-organization-views.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.299 — the organization views contract (ADR 0108 Amendment 1, ADR 0030)", () => {
  it("parses a full response", () => spec.assertAFullFixtureParses());
  it("refuses hour 24", () => spec.assertHour24IsRefused());
  it("refuses a normal verdict (counted, never sent)", () => spec.assertANormalVerdictIsRefused());
  it("parses an other column and refuses a site column without its id", () => spec.assertTheOtherColumnParsesAndASiteNeedsItsId());
  it("parses null compare and partial", () => spec.assertNullCompareAndPartialParse());
  it("types trend kw as a number array", () => spec.assertTrendKwIsANumberArray());
});
