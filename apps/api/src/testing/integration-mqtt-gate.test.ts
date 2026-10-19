import { describe, it } from "vitest";

import {
  assertCiIsDetectedByValue,
  assertRefusalThrowsWithTheCallersReason,
  assertSetUrlRunsInCi,
  assertSetUrlRunsLocally,
  assertSkipReturnsUndefined,
  assertUnsetInCiRefuses,
  assertUnsetLocallySkips,
} from "./integration-mqtt-gate.spec";

/**
 * `F3.24b` — Vitest entry point for the MQTT broker gate. Needs no broker: it
 * tests the gate, not what is behind it, so it runs everywhere.
 */
describe("F3.24b — the integration-test MQTT broker gate", () => {
  it("runs when MQTT_TEST_URL is set locally", () => assertSetUrlRunsLocally());
  it("runs when MQTT_TEST_URL is set in CI", () => assertSetUrlRunsInCi());
  it("skips when MQTT_TEST_URL is unset locally", () => assertUnsetLocallySkips());
  it("refuses when MQTT_TEST_URL is unset in CI", () => assertUnsetInCiRefuses());
  it("detects CI by exact value", () => assertCiIsDetectedByValue());
  it("throws in CI with the caller's reason", () => assertRefusalThrowsWithTheCallersReason());
  it("returns undefined and explains itself when skipping", () => assertSkipReturnsUndefined());
});
