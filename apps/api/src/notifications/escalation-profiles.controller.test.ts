import { describe, it } from "vitest";

import { runEscalationProfilesControllerTests } from "./escalation-profiles.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.10 escalation profiles controller", () => {
  it("mounts both routes, answers a bad body with Zod's flatten, and turns a missing profile into a 404", async () => {
    await runEscalationProfilesControllerTests();
  });
});
