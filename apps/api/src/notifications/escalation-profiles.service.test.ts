import { describe, it } from "vitest";

import { runEscalationProfilesServiceTests } from "./escalation-profiles.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.10 escalation profiles service", () => {
  it("resolves the organization, refuses an unpairable channel before writing, and audits every write", async () => {
    await runEscalationProfilesServiceTests();
  });
});
