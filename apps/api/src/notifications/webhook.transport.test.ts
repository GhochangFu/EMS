import { describe, it } from "vitest";

import { assertWebhookIgnoresAttachments, runWebhookTransportTests } from "./webhook.transport.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 webhook transport", () => {
  it("signs the exact bytes, refuses before fetch, and never puts the URL in the error", async () => {
    await runWebhookTransportTests();
  });

  it("F3.5b — posts a body with no attachments key when the message carries attachments (ADR 0071 decision 10)", async () => {
    await assertWebhookIgnoresAttachments();
  });
});
