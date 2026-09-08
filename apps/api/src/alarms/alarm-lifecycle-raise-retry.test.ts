import { describe, it } from "vitest";

import { runAlarmLifecycleRaiseRetryTests } from "./alarm-lifecycle-raise-retry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-lifecycle raise-retry phase", () => {
  it("re-offers an undelivered raise to the channels the ledger still owes it, and to nobody else", async () => {
    await runAlarmLifecycleRaiseRetryTests();
  });
});
