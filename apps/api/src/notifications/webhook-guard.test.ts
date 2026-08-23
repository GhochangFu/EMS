import { describe, it } from "vitest";

import { runWebhookGuardTests } from "./webhook-guard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 webhook egress guard", () => {
  it("refuses non-https, private, unresolvable and literal targets, and never names the URL", async () => {
    await runWebhookGuardTests();
  });
});
