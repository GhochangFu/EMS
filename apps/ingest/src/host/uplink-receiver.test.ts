import { describe, it } from "vitest";

import {
  aFailedWriteRejectsAndReleases,
  aGatewayWithNoRtusCountsEverythingForeign,
  aGoodSampleIsWrittenAndAccepted,
  everyRejectionIsCounted,
  healthIsRecordedOnlyAfterACommittedWrite,
  aFailedWriteDestroysAGoodOneReturns,
  aTimedOutWriteRejectsAndDestroysTheClient,
  lateRowsAreLoggedAsNotNotified,
  theRejectionWarnIsThrottled,
  theWriteBindsTheDigest,
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

  it("binds the presented digest into the gateway UPDATE (M1)", async () => {
    await theWriteBindsTheDigest();
  });

  it("rejects a write past the timeout and destroys its client (L1)", async () => {
    await aTimedOutWriteRejectsAndDestroysTheClient();
  });

  it("destroys a failed write's client and pools a good one", async () => {
    await aFailedWriteDestroysAGoodOneReturns();
  });

  it("throttles the rejected-samples line per gateway (M2)", async () => {
    await theRejectionWarnIsThrottled();
  });

  it("records device health after a committed write only (F3.16)", async () => {
    await healthIsRecordedOnlyAfterACommittedWrite();
  });
});
