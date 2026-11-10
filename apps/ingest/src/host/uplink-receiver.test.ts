import { describe, it } from "vitest";

import {
  aFailedWriteRejectsAndReleases,
  aGatewayWithNoRtusCountsEverythingForeign,
  aGoodSampleIsWrittenAndAccepted,
  everyRejectionIsCounted,
  lateRowsAreLoggedAsNotNotified,
} from "./uplink-receiver.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the uplink receiver end to end on a fake client (ADR 0123 decision 4)", () => {
  it("writes a good sample through the gateway's own index", async () => {
    await aGoodSampleIsWrittenAndAccepted();
  });

  it("counts every rejection reason in the 200 body", async () => {
    await everyRejectionIsCounted();
  });

  it("counts every sample foreign for a gateway with no RTUs", async () => {
    await aGatewayWithNoRtusCountsEverythingForeign();
  });

  it("rejects on a failed write and releases the client", async () => {
    await aFailedWriteRejectsAndReleases();
  });

  it("logs late rows as written and not notified", async () => {
    await lateRowsAreLoggedAsNotNotified();
  });
});
