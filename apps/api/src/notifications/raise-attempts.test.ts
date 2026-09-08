import { describe, it } from "vitest";

import { runRaiseAttemptsBatchTests } from "./raise-attempts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.51 raise-attempts batching", () => {
  it("chunks the refs, binds only each batch's own, and loses only a failing batch", async () => {
    await runRaiseAttemptsBatchTests();
  });
});
