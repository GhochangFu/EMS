import { describe, it } from "vitest";

import { aPerDeviceProtocolIsOnePlanPerDevice, oneBrokerIsOnePlan, twoFileEndpointsOnOneKeyAreRefused } from "./edge-plan.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge endpoint plan (ADR 0123 decision 3, plan T5.2)", () => {
  it("builds one plan per MQTT broker with an empty point index", () => {
    oneBrokerIsOnePlan();
  });

  it("builds one plan per factory.endpointKey, sourceKeys defaulting to []", () => {
    aPerDeviceProtocolIsOnePlanPerDevice();
  });

  it("refuses two file endpoints with one endpoint key", () => {
    twoFileEndpointsOnOneKeyAreRefused();
  });
});
