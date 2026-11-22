import { describe, it } from "vitest";

import {
  assertABadEndpointValueFallsToTheOrganizationWithOneWarning,
  assertABadOrganizationValueFallsToTheAdapterWithOneWarning,
  assertAWarningNeverHoldsTheNumber,
  assertNeitherMeansTheAdapterDefault,
  assertTheEndpointValueWins,
  assertTheOrganizationValueIsNext,
  assertTheShortestIntervalOnAnEndpointWins,
  assertTheSleepTakesTheAdapterDefaultOnlyWhereAnRtuUsesIt,
} from "./poll-interval.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — poll interval resolution (ADR 0016 Amendment 10 (a))", () => {
  it("P1 the endpoint value wins", () => assertTheEndpointValueWins());
  it("P2 else the organization's", () => assertTheOrganizationValueIsNext());
  it("P3 else the adapter default (null)", () => assertNeitherMeansTheAdapterDefault());
  it("P4 a bad endpoint value falls to the organization with one warning", () =>
    assertABadEndpointValueFallsToTheOrganizationWithOneWarning());
  it("P5 a bad organization value falls to the adapter with one warning", () =>
    assertABadOrganizationValueFallsToTheAdapterWithOneWarning());
  it("P6 a warning never holds the number", () => assertAWarningNeverHoldsTheNumber());
  it("P7 the shortest interval on an endpoint wins (P9)", () => assertTheShortestIntervalOnAnEndpointWins());
  it("P8 the sleep takes the adapter default only where an RTU uses it", () =>
    assertTheSleepTakesTheAdapterDefaultOnlyWhereAnRtuUsesIt());
});
