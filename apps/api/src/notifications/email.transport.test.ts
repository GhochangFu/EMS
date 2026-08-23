import { describe, it } from "vitest";

import { runEmailTransportTests } from "./email.transport.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 email transport", () => {
  it("skips when unconfigured and never puts a recipient or password in the error", async () => {
    await runEmailTransportTests();
  });
});
