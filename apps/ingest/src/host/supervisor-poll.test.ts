import { describe, it } from "vitest";

import {
  assertAConnectedFailingPollAdapterIsPolledAgain,
  assertAGoodReadResetsTheBackoff,
  assertAStopDuringAReadLogsNoFailure,
  assertADisconnectedPollAdapterIsRestartedThroughTheBackoff,
  assertANullPlanIntervalIsTheAdapterDefault,
  assertRepeatedRestartsBackOff,
  assertAnRtuOnTheDefaultCapsALongerInterval,
  assertThePlanIntervalIsTheCadence,
} from "./supervisor-poll.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the poll loop (ADR 0016 Amendment 10 (a), (c))", () => {
  it("S1 sleeps the plan's interval, never the adapter default", async () => {
    await assertThePlanIntervalIsTheCadence();
  });
  it("S2 sleeps the adapter default when the plan has none", async () => {
    await assertANullPlanIntervalIsTheAdapterDefault();
  });
  it("S3 lets an RTU on the default cap a longer interval (P9)", async () => {
    await assertAnRtuOnTheDefaultCapsALongerInterval();
  });
  it("S4 restarts a poll adapter whose health says disconnected, through the backoff (P10)", async () => {
    await assertADisconnectedPollAdapterIsRestartedThroughTheBackoff();
  });
  it("S5 polls a connected but failing adapter again, with no restart", async () => {
    await assertAConnectedFailingPollAdapterIsPolledAgain();
  });
  it("S6 backs off across restarts of a socket that drops at once (security review M1)", async () => {
    await assertRepeatedRestartsBackOff();
  });
  it("S7 resets the backoff after one good read", async () => {
    await assertAGoodReadResetsTheBackoff();
  });
  it("S8 logs no failure for a read rejected by a stop", async () => {
    await assertAStopDuringAReadLogsNoFailure();
  });
});
