import { describe, it } from "vitest";

import {
  assertConformedServiceSlots,
  assertUnconditionalFleetReadSlots,
} from "./fleet-read-wiring.spec";

/**
 * `E7.1b` — Vitest entry point for the pool-token/constructor-slot wiring guard.
 * Assertions live in the sibling `.spec` (ADR 0014).
 */
describe("E7.1b — services inject the right pool token in the right constructor slot", () => {
  it("unconditional cross-org readers inject the fleet pool in the read slot", () => {
    assertUnconditionalFleetReadSlots();
  });

  it("the four conformed decision-1 services inject both tokens in the right slots", () => {
    assertConformedServiceSlots();
  });
});
