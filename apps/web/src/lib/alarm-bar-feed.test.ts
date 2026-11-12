import { describe, it } from "vitest";

import * as spec from "./alarm-bar-feed.spec";

/** `F4.357` U4 — Vitest entry point. Assertions live in `alarm-bar-feed.spec.ts` (ADR 0014). */
describe("alarm bar feed (F4.357, ADR 0130 decisions 13, 16)", () => {
  it("a token opens one socket and reads the list and the summary once", () => spec.aTokenOpensOneSocketAndReadsOnce());
  it("a scope change reads at once and drops the old scope's late answer (D7)", () => spec.aScopeChangeReadsAtOnceAndDropsALateAnswer());
  it("a burst of events reads once, after one second (D6)", () => spec.aBurstReadsOnceAfterOneSecond());
  it("an event storm still reads every second (D6)", () => spec.aStormStillReadsEverySecond());
  it("a connect reads, and an event during a read in flight reads once more", () => spec.aConnectReadsAndAnInFlightEventReadsOnceMore());
  it("a failed read is stale, keeps the list and retries at 30 s (D15)", () => spec.aFailedReadIsStaleAndRetries());
  it("a lost socket marks the feed stale", () => spec.aDisconnectMarksTheFeedStale());
  it("a renewed token reopens the socket and keeps the list", () => spec.aRenewedTokenReopensTheSocketAndKeepsTheList());
  it("a session end closes the socket, clears every timer and resets the store", () => spec.aSessionEndLeavesNothing());
  it("a second install opens no second socket", () => spec.aSecondInstallOpensNothing());
  it("a sign-in opens the socket and reads", () => spec.aSignInOpensTheSocket());
  it("an older read of the same scope is dropped, its failure too (D7)", () => spec.anOlderReadOfTheSameScopeIsDropped());
  it("a successful read does not hide a lost socket", () => spec.aReadDoesNotHideALostSocket());
  it("a hung read fails at 15 s and the feed recovers", () => spec.aHungReadFailsAndTheFeedRecovers());
  it("Close marks the shown rows seen; a new alarm pops up alone (U6)", () => spec.closeMarksTheShownRowsSeen());
  it("seen lasts for the tab's session, not past it (U6, decision 21)", () => spec.seenLastsForTheTabsSession());
  it("acknowledge calls once per alarm in order, keeps failures, then reads (U6)", () => spec.acknowledgeCallsOncePerAlarmInOrder());
});
