import { describe, it } from "vitest";

import { runTelemetryListenerTests } from "./telemetry-listener.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("telemetry-listener", () => {
  it("reconnects and re-LISTENs (F4.34), and validates payloads before broadcast (F4.36)", async () => {
    await runTelemetryListenerTests();
  });
});
