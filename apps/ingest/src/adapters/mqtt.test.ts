import { describe, it } from "vitest";

import { runAdapterContractTests } from "../adapter/adapter-contract.spec.js";
import { lookupAdapter } from "../adapter/registry.js";
import { mqttAdapterFactory } from "./mqtt.js";
import { mqttContractFixtures, runMqttAdapterTests } from "./mqtt.spec.js";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The shape every F1.2–F1.6 adapter test copies: the shared contract suite
 * **plus** the protocol's own cases (ADR 0016 §7).
 */
describe("mqtt adapter", () => {
  it("is the factory the registry serves for `mqtt`", () => {
    // The conformance suite checks `factory.protocol` against the registry key
    // it is *told*; this checks the registry actually resolves to this factory.
    // Together they close the loop a static map could otherwise leave open.
    if (lookupAdapter("mqtt") !== mqttAdapterFactory) {
      throw new Error("registry.mqtt does not resolve to mqttAdapterFactory");
    }
  });

  it("satisfies the shared adapter contract", async () => {
    await runAdapterContractTests(mqttAdapterFactory, mqttContractFixtures);
  });

  it("parses ThinkIoT payloads exactly as index.js does", async () => {
    await runMqttAdapterTests();
  });
});
