import { describe, it } from "vitest";

import {
  assertAnAbsentBagBecomesTheDerivedKey,
  assertTheDerivedValueWinsAndTheSiblingKeySurvives,
  assertTheInputBagIsNotMutated,
} from "./telemetry-source.spec";

/**
 * `F4.139` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns nothing but the block structure.
 */
describe("F4.139 — withTelemetrySource merges over the caller's meta bag", () => {
  it("writes the derived key when there is no bag at all", () => {
    assertAnAbsentBagBecomesTheDerivedKey();
  });

  it("lets the derived value win and keeps the sibling key", () => {
    assertTheDerivedValueWinsAndTheSiblingKeySurvives();
  });

  it("does not mutate the caller's bag", () => {
    assertTheInputBagIsNotMutated();
  });
});
