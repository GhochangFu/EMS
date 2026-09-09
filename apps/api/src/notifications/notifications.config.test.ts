import { describe, it } from "vitest";

import {
  runLogTransportTests,
  runNotificationsConfigTests,
  runStepLatenessConfigTests,
} from "./notifications.config.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 notifications config", () => {
  it("treats a missing SMTP_HOST as unconfigured and refuses to half-disable the webhook rule", () => {
    runNotificationsConfigTests();
  });

  it("reads the escalation age cut-off in minutes and refuses a bound that is not finite", () => {
    runStepLatenessConfigTests();
  });

  it("logs a skip with identifiers only, never recipients, secrets or content", async () => {
    await runLogTransportTests();
  });
});
