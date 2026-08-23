import { describe, it } from "vitest";

import { runNotificationsServiceTests } from "./notifications.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 notifications service", () => {
  it("dedupes, rate-limits, records every skip, and never rejects into its caller", async () => {
    await runNotificationsServiceTests();
  });
});
