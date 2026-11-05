import { describe, it } from "vitest";

import { bothBodiesAreRegisteredAndLedgered } from "./point-key-states.registry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.309 — the state-label bodies in the registry and the ledger", () => {
  it("registers both bodies by identity and records their strictness", () => {
    bothBodiesAreRegisteredAndLedgered();
  });
});
