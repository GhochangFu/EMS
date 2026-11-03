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

describe("F4.304 — kWh per m² on the site ranking (ADR 0108 Amendment 5, item 7)", () => {
  it("divides kWh by the area", () => spec.assertKwhPerSquareMetreDivides());
  it("keeps a zero kWh as 0", () => spec.assertZeroKwhIsAZeroNotANull());
  it("gives null with no area", () => spec.assertNoAreaIsNull());
  it("gives null for an area of 0 (fail closed)", () => spec.assertAZeroAreaFailsClosed());
  it("gives null for an area of NaN (fail closed)", () => spec.assertANaNAreaFailsClosed());
  it("parses a site with no area", () => spec.assertASiteWithNoAreaParses());
  it("refuses a string area", () => spec.assertAStringAreaIsRefused());
});
