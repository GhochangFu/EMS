import { describe, it } from "vitest";

import {
  assertAnAnsweringEndpointBootsAndClearsTheTimer,
  assertAnUnconfiguredClientBootsWithoutATimer,
  assertASilentEndpointRefusesTheBoot,
  assertBootstrapTimeoutIsTenSeconds,
  assertTheBootIsNotRefusedBeforeTheTimeout,
  assertTheRefusalNamesTheTimeoutAndNotTheEndpoint,
} from "./storage.bootstrap.spec";

/**
 * F3.3 (ADR 0066 decision 9) — Vitest entry point for the bounded
 * `StorageBootstrap`. Assertions live in the sibling `.spec` (§4.6/ADR 0014);
 * this file only runs them.
 */
describe("F3.3 — StorageBootstrap.onModuleInit is bounded", () => {
  it("bounds the boot at 10 000 ms", () => {
    assertBootstrapTimeoutIsTenSeconds();
  });

  it("refuses the boot when ensureBucket never settles", async () => {
    await assertASilentEndpointRefusesTheBoot();
  });

  it("does not refuse before the timeout elapses", async () => {
    await assertTheBootIsNotRefusedBeforeTheTimeout();
  });

  it("the refusal names the timeout and never the endpoint", async () => {
    await assertTheRefusalNamesTheTimeoutAndNotTheEndpoint();
  });

  it("boots and clears the timer when the store answers (positive control)", async () => {
    await assertAnAnsweringEndpointBootsAndClearsTheTimer();
  });

  it("arms no timer for an unconfigured client", async () => {
    await assertAnUnconfiguredClientBootsWithoutATimer();
  });
});
