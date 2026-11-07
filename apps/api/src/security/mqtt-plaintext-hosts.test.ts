import { describe, it } from "vitest";

import {
  bothModulesRegisterTheProvider,
  theFactoryThrowsOnABadEntry,
  theReadParsesTheList,
} from "./mqtt-plaintext-hosts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — MQTT_PLAINTEXT_HOSTS in the API and worker (ADR 0114)", () => {
  it("M1 parses the list", () => theReadParsesTheList());
  it("M2 throws on a bad entry, naming its position only", () => theFactoryThrowsOnABadEntry());
  it("M3 is registered in AdminModule and OnboardingDiscoveryModule", () => bothModulesRegisterTheProvider());
});
