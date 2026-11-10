import { describe, it } from "vitest";

import {
  runCredentialKeyOpenWindowAcceptedTests,
  runCredentialKeyShortPreviousRefusedTests,
  runCredentialKeyUnsetTests,
  runCredentialKeyVersionZeroRefusedTests,
  runHostConfigTests,
  runMqttPlaintextHostsConfigTests,
  runNotifyLiveWindowConfigTests,
  runUplinkLimitsConfigTests,
  runUplinkPortConfigTests,
} from "./config.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host config", () => {
  it("defaults NOTIFY off and refuses ambiguous values", () => {
    runHostConfigTests();
  });

  it("refuses to boot on a previous key at version 0 (ADR 0062 decision 5)", () => {
    runCredentialKeyVersionZeroRefusedTests();
  });

  it("boots on an open rotation window and reports the key configured", () => {
    runCredentialKeyOpenWindowAcceptedTests();
  });

  it("boots with no key configured, and says it is unconfigured", () => {
    runCredentialKeyUnsetTests();
  });

  it("refuses to boot on a previous key that is not 32 bytes (Amendment 1)", () => {
    runCredentialKeyShortPreviousRefusedTests();
  });

  it("parses MQTT_PLAINTEXT_HOSTS and refuses to boot on a bad entry (ADR 0114)", () => {
    runMqttPlaintextHostsConfigTests();
  });

  it("bounds INGEST_NOTIFY_LIVE_WINDOW_MS to 60 s – 15 min and refuses to boot outside (ADR 0123)", () => {
    runNotifyLiveWindowConfigTests();
  });

  it("reads INGEST_UPLINK_PORT, unset meaning no listener (ADR 0123 decision 4)", () => {
    runUplinkPortConfigTests();
  });

  it("bounds the uplink sample rate and connection count (security review M2, L2)", () => {
    runUplinkLimitsConfigTests();
  });
});
