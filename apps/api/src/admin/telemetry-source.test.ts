import { describe, it } from "vitest";

import {
  assertAnAbsentBagBecomesTheDerivedKey,
  assertOmitDoesNotMutateTheInput,
  assertOmitKeepsTheSiblingKeys,
  assertOmitLeavesAnAbsentBagNull,
  assertOmitLeavesANullBagNull,
  assertOmitRemovesTheKey,
  assertTheDerivedValueWinsAndTheSiblingKeySurvives,
  assertTheInputBagIsNotMutated,
  assertTheMergeReturnsANewObject,
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

  it("returns a new object rather than the caller's bag", () => {
    assertTheMergeReturnsANewObject();
  });
});

describe("F4.139 — omitTelemetrySource strips a key no RTU authorized", () => {
  it("removes the telemetrySource key", () => {
    assertOmitRemovesTheKey();
  });

  it("keeps every sibling key", () => {
    assertOmitKeepsTheSiblingKeys();
  });

  it("leaves a null bag null", () => {
    assertOmitLeavesANullBagNull();
  });

  it("leaves an absent bag null", () => {
    assertOmitLeavesAnAbsentBagNull();
  });

  it("does not mutate the caller's bag", () => {
    assertOmitDoesNotMutateTheInput();
  });
});
