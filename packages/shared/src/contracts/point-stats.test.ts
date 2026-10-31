import { describe, it } from "vitest";

import * as spec from "./point-stats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.291 PR 3 — the get_point_stats contract (ADR 0030)", () => {
  it("parses a full answer", () => spec.assertTheFixtureParses());
  it("refuses a negative sample count", () => spec.assertANegativeSampleCountIsRefused());
  it("refuses a row without the last key (null is required, not absent)", () => spec.assertAMissingLastKeyIsRefused());
  it("refuses more than 25 rows", () => spec.assertMoreThan25RowsAreRefused());
  it("refuses an answer without the period it covers", () => spec.assertAnAnswerWithoutTheCoveredPeriodIsRefused());
});
