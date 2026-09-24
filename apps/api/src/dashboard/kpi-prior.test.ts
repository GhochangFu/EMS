import { describe, it } from "vitest";

import {
  assertEmptyPriorCarriesItsInstant,
  assertOffsetIs24Hours,
  assertPriorInstantIsExactly24HoursEarlier,
} from "./kpi-prior.spec";

/**
 * `F3.28` — Vitest wrapper for the pure KPI prior helpers. Assertions live in
 * the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F3.28 — the KPI prior instant", () => {
  it("is exactly 24 h before asOf", () => {
    assertPriorInstantIsExactly24HoursEarlier();
  });

  it("spells the offset as 86 400 000 ms", () => {
    assertOffsetIs24Hours();
  });

  it("gives an empty scope a prior that still names its instant", () => {
    assertEmptyPriorCarriesItsInstant();
  });
});
