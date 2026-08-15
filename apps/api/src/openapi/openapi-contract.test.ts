import { describe, it } from "vitest";

import {
  testEveryRegisteredSchemaExplainsItsRefinements,
  testTheMarkerReachesTheRealSchemas,
  testTheRegistryIsPopulatedAndConverts,
} from "./openapi-contract.spec";

/**
 * `F4.20` / ADR 0029 decision 10 — Vitest entry point. Assertions live in the
 * sibling `.spec` (§4.6).
 */
describe("ADR 0029 — the registered schemas explain what the document cannot", () => {
  it("leaves no refinement unexplained", () => {
    testEveryRegisteredSchemaExplainsItsRefinements();
  });

  it("has a populated registry whose schemas convert", () => {
    testTheRegistryIsPopulatedAndConverts();
  });

  it("still emits the marker on schemas that carry refinements", () => {
    testTheMarkerReachesTheRealSchemas();
  });
});
