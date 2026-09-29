import { describe, it } from "vitest";

import {
  assertTheTestNotificationBodyNamesIonsiteNexus,
  assertTheTestNotificationSubjectNamesIonsiteNexus,
  runNotificationsServiceTests,
} from "./notifications.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 notifications service", () => {
  it("dedupes, rate-limits, records each refusal once, and never rejects into its caller", async () => {
    await runNotificationsServiceTests();
  });
});

describe("F3.33 the test notification names IONSiTE NEXUS", () => {
  it("puts IONSiTE NEXUS and the channel code in the subject", async () => {
    await assertTheTestNotificationSubjectNamesIonsiteNexus();
  });

  it("puts IONSiTE NEXUS in the body", async () => {
    await assertTheTestNotificationBodyNamesIonsiteNexus();
  });
});
