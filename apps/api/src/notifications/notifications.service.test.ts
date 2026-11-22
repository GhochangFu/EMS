import { describe, it } from "vitest";

import {
  assertTheTestNotificationBodyNamesVerve,
  assertTheTestNotificationSubjectNamesVerve,
  runNotificationsServiceTests,
} from "./notifications.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 notifications service", () => {
  it("dedupes, rate-limits, records each refusal once, and never rejects into its caller", async () => {
    await runNotificationsServiceTests();
  });
});

describe("F4.398 the test notification names Verve", () => {
  it("puts Verve and the channel code in the subject", async () => {
    await assertTheTestNotificationSubjectNamesVerve();
  });

  it("puts Verve in the body", async () => {
    await assertTheTestNotificationBodyNamesVerve();
  });
});
