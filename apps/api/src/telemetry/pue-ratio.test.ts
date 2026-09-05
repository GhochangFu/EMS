import { describe, it } from "vitest";

import {
  assertEstateIsKwWeighted,
  assertNonFiniteIsNull,
  assertOneIncomerIsItsOwnRatio,
  assertRoundsToTwoDecimals,
  assertZeroIncomersIsNull,
  assertZeroItLoadIsNull,
} from "./pue-ratio.spec";

/**
 * `F2.8` — Vitest wrapper for the pure PUE arithmetic. Assertions live in the
 * sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F2.8 — PUE is a ratio of two sums, or nothing", () => {
  it("returns null when no incomer in scope computes the pair (ruling 4)", () => {
    assertZeroIncomersIsNull();
  });

  it("returns null rather than a sentinel when the IT load is zero (ruling 4)", () => {
    assertZeroItLoadIsNull();
  });

  it("weights the estate figure by kW, not by site (ruling 3)", () => {
    assertEstateIsKwWeighted();
  });

  it("reduces to one site's own ratio when one incomer is in scope (ruling 3)", () => {
    assertOneIncomerIsItsOwnRatio();
  });

  it("rounds to two decimals like every other number on the ribbon", () => {
    assertRoundsToTwoDecimals();
  });

  it("never lets a non-finite result reach the nullable contract", () => {
    assertNonFiniteIsNull();
  });
});
