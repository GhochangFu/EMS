import { describe, it } from "vitest";

import {
  assertAnMqttPlanIsUnchanged,
  assertAnOutOfBoundsValueWarnsByLevelAndFallsBack,
  assertTheAdapterSchemaNeverSeesTheInterval,
  assertTheConfigFingerprintFollowsTheSlicesNotTheInterval,
  assertThePlanCarriesTheResolvedInterval,
  assertTheQuerySelectsTheOrganizationInterval,
  assertTheShortestIntervalOnASharedGatewayWins,
} from "./bindings-poll-interval.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the binding plan resolves the poll interval (ADR 0016 Amendment 10 (a))", () => {
  it("B1 the query selects the organization interval", () => assertTheQuerySelectsTheOrganizationInterval());
  it("B2 the plan carries the resolved interval", () => assertThePlanCarriesTheResolvedInterval());
  it("B3 the adapter's schema never sees pollIntervalMs", () => assertTheAdapterSchemaNeverSeesTheInterval());
  it("B4 the shortest interval on a shared gateway wins (P9)", () => assertTheShortestIntervalOnASharedGatewayWins());
  it("B5 an out-of-bounds value warns by level and falls back", () =>
    assertAnOutOfBoundsValueWarnsByLevelAndFallsBack());
  it("B6 the config fingerprint follows the slices, not the interval", () =>
    assertTheConfigFingerprintFollowsTheSlicesNotTheInterval());
  it("B7 an MQTT plan is unchanged", () => assertAnMqttPlanIsUnchanged());
});
