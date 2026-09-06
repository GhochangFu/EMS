import { describe, it } from "vitest";

import { runNotificationEventTests } from "./notifications.events.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.10 notification events", () => {
  it("sends a step or a cleared message once per key, retries a failed one three times, and stays inside the rule's organization", async () => {
    await runNotificationEventTests();
  });
});
