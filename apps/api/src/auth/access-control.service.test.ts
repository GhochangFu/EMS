import { describe, it } from "vitest";

import { runAccessControlServiceTests } from "./access-control.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.1c canManageNotificationChannel", () => {
  it("gates a channel write the way canManagePointKey gates a point key, minus the null-org exception", async () => {
    await runAccessControlServiceTests();
  });
});
