import { describe, it } from "vitest";

import { runAuthModeTests } from "./auth-mode.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("auth-mode", () => {
  it("disables local password login whenever OIDC is configured", async () => {
    await runAuthModeTests();
  });
});
