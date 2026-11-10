import { describe, it } from "vitest";

import {
  aFailingUpdateRollsBackAndNotifiesNothing,
  aHugeBufferedIsClamped,
  aLiveOnlyBatchBindsNoWindow,
  anInactiveGatewayRollsBack,
  theOrderIsBeginUpsertUpdateCommitNotify,
  theSqlWidensAndFiltersByGateway,
  theUpdateBindsTheReportAndTheWindow,
  zeroRowsStillRecordsTheGateway,
} from "./uplink-write.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the uplink write and the gateway report share a transaction (ADR 0123 decision 11)", () => {
  it("runs BEGIN, upsert, gateway UPDATE, COMMIT, then notify", async () => {
    await theOrderIsBeginUpsertUpdateCommitNotify();
  });

  it("rolls back and notifies nothing when the UPDATE fails", async () => {
    await aFailingUpdateRollsBackAndNotifiesNothing();
  });

  it("rolls back when the gateway is no longer active", async () => {
    await anInactiveGatewayRollsBack();
  });

  it("records the gateway for a batch with zero rows", async () => {
    await zeroRowsStillRecordsTheGateway();
  });

  it("binds the report and the late rows' span", async () => {
    await theUpdateBindsTheReportAndTheWindow();
  });

  it("binds no window for a live-only batch", async () => {
    await aLiveOnlyBatchBindsNoWindow();
  });

  it("clamps a buffered count above int4", async () => {
    await aHugeBufferedIsClamped();
  });

  it("widens with LEAST / GREATEST and filters by gateway id", () => {
    theSqlWidensAndFiltersByGateway();
  });
});
