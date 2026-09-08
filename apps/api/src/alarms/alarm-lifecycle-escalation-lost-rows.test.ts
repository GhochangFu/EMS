import { describe, it } from "vitest";

import { runEscalationLostRowTests } from "./alarm-lifecycle-escalation-lost-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-lifecycle escalation lost rows", () => {
  it("stops re-offering a step whose delivery row did not land, under the step's own key", async () => {
    await runEscalationLostRowTests();
  });
});
