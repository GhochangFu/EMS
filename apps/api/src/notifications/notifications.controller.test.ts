import { describe, it } from "vitest";

import { runNotificationsControllerTests } from "./notifications.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 notifications controller", () => {
  it("gates channels on admin, leaves readiness open, and never returns a secret", async () => {
    await runNotificationsControllerTests();
  });
});
