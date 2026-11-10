import { describe, it } from "vitest";

import {
  runBindingQuerySelectsTheGatewayTests,
  runDecidedBeforeConfigAndCredentialsTests,
  runEdgeServedCarriesTheEndpointsPointIndexTests,
  runEdgeServedCountsTests,
  runEdgeServedRtuIsInNoEndpointTests,
  runEdgeServedRtuIsNotSkippedTests,
  runMixedEndpointKeepsTheRestTests,
  runSwitchedOffOrganizationIsSkippedNotEdgeServedTests,
  runTelemetrySourceFilterStillAppliesTests,
} from "./bindings-edge.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host binding plan — edge-served RTUs (ADR 0123 decision 6)", () => {
  it("E0 selects r.edge_gateway_id in the binding query, unfiltered", () => {
    runBindingQuerySelectsTheGatewayTests();
  });
  it("E1 puts an edge-served RTU in no endpoint, and plans no all-edge endpoint", () => {
    runEdgeServedRtuIsInNoEndpointTests();
  });
  it("E2 carries its targets in edgeServed, equal to the endpoint's point index", () => {
    runEdgeServedCarriesTheEndpointsPointIndexTests();
  });
  it("E3 does not list an edge-served RTU in skipped", () => {
    runEdgeServedRtuIsNotSkippedTests();
  });
  it("E4 keeps the cloud RTUs of a mixed endpoint and keeps gateways apart", () => {
    runMixedEndpointKeepsTheRestTests();
  });
  it("E5 skips a switched-off organization's RTU and leaves it out of edgeServed", () => {
    runSwitchedOffOrganizationIsSkippedNotEdgeServedTests();
  });
  it("E6 still applies the MQTT telemetrySource filter", () => {
    runTelemetrySourceFilterStillAppliesTests();
  });
  it("E7 decides before config and credentials", () => {
    runDecidedBeforeConfigAndCredentialsTests();
  });
  it("E8 counts edge-served gateways and RTUs for the host log", () => {
    runEdgeServedCountsTests();
  });
});
