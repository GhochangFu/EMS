import { describe, it } from "vitest";

import { F378_BODIES, ledgerRecordsStrictBodies, registryHoldsBody } from "./f3-78-bodies.spec";

/** `F3.78` — Vitest entry point (§4.6). */
describe("F3.78 — request bodies are registered", () => {
  for (const [operationId] of F378_BODIES) {
    it(`registers the body of ${operationId}`, () => {
      registryHoldsBody(operationId);
    });
  }

  it("records a ledger decision for every strict body", () => {
    ledgerRecordsStrictBodies();
  });
});
