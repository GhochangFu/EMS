import { describe, it } from "vitest";

import { runSupervisorValveTests } from "./supervisor-valve.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("supervisor: the replay loop's safety valve", () => {
  it("holds while a spill is in flight and resets the probe backoff when it fires", async () => {
    await runSupervisorValveTests();
  });
});
