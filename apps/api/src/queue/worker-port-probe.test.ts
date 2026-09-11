import { describe, it } from "vitest";

import {
  assertBoundPortRejectsNamingThePortAndTheCode,
  assertDefaultListenRejectsOnAPortAnotherServerHolds,
  assertDefaultListenResolvesOnAFreePort,
  assertFreePortIsReleasedOnce,
} from "./worker-port-probe.spec";

/**
 * F4.24 (ADR 0063 decision 9) — Vitest entry point for the worker's port
 * pre-flight. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this
 * file only runs them.
 */
describe("F4.24 — probeWorkerPortFree", () => {
  it("rejects with QueueConfigError naming the port and EADDRINUSE when listen fails", async () => {
    await assertBoundPortRejectsNamingThePortAndTheCode();
  });

  it("releases the pre-flight listener exactly once on a free port", async () => {
    await assertFreePortIsReleasedOnce();
  });

  it("resolves on a free ephemeral port with the default listen", async () => {
    await assertDefaultListenResolvesOnAFreePort();
  });

  it("rejects on a port another server holds with the default listen", async () => {
    await assertDefaultListenRejectsOnAPortAnotherServerHolds();
  });
});
