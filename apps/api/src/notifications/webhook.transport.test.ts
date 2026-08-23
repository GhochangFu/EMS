import { describe, it } from "vitest";

import { runWebhookTransportTests } from "./webhook.transport.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 webhook transport", () => {
  it("signs the exact bytes, refuses before fetch, and never puts the URL in the error", async () => {
    await runWebhookTransportTests();
  });
});
