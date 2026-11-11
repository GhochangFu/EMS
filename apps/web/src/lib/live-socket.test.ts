import { describe, it } from "vitest";

import {
  aMalformedRefusalFallsBackToTheDefaultWait,
  aSecondRefusalSchedulesAgain,
  aSpentRefusalDoesNotOutliveItsDisconnect,
  leavesOtherServerDisconnectsAlone,
  onlyAServerDisconnectSchedulesTheRetry,
  reconnectsOnceAfterTheRetryAfterWait,
  theCallersDisconnectCancelsThePendingReconnect,
} from "./live-socket.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.17 — a rate-limited socket reconnects after Retry-After (ADR 0125, plan §11)", () => {
  it("reconnects once, after retryAfterSeconds plus jitter, and not before", () => {
    reconnectsOnceAfterTheRetryAfterWait();
  });

  it("leaves a server disconnect with no refusal alone", () => {
    leavesOtherServerDisconnectsAlone();
  });

  it("schedules the retry only on the server's disconnect", () => {
    onlyAServerDisconnectSchedulesTheRetry();
  });

  it("cancels a pending reconnect when the caller disconnects", () => {
    theCallersDisconnectCancelsThePendingReconnect();
  });

  it("falls back to the default wait for a body that does not parse", () => {
    aMalformedRefusalFallsBackToTheDefaultWait();
  });

  it("spends a refusal on the disconnect that follows it", () => {
    aSpentRefusalDoesNotOutliveItsDisconnect();
  });

  it("schedules again on a second refusal", () => {
    aSecondRefusalSchedulesAgain();
  });
});
