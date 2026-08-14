import { describe, it } from "vitest";

import { runTelemetryListenerTests } from "./telemetry-listener.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("telemetry-listener", () => {
  it("reconnects, re-LISTENs, and survives bad payloads (F4.34)", async () => {
    await runTelemetryListenerTests();
  });
});
