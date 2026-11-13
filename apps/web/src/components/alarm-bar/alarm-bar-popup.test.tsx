// @vitest-environment jsdom
import { describe, it } from "vitest";

import * as spec from "./alarm-bar-popup.spec";

/** `F4.357` U6 — Vitest entry point. Assertions live in `alarm-bar-popup.spec.tsx` (ADR 0014). */
describe("alarm bar popup (F4.357, ADR 0130 decisions 6–8, 18, 21)", () => {
  it("opens at rank 20 and above, not for rank 10 alone", () => spec.opensAtRankTwentyAndAbove());
  it("orders by rank then newest, and an arrival joins the one popup", () => spec.ordersByRankThenNewestAndAnArrivalJoins());
  it("Close hides it and only a new alarm reopens it", () => spec.closeHidesItAndOnlyANewAlarmReopensIt());
  it("seen survives an in-app navigation, not a new session", () => spec.seenSurvivesNavigationButNotASession());
  it("a row leaves when acknowledged elsewhere or cleared", () => spec.rowsLeaveWhenAcknowledgedElsewhereOrCleared());
  it("Acknowledge all asks one reason and calls once per row in order", () => spec.acknowledgeAllAsksOneReasonAndCallsInOrder());
  it("a failed row stays with its error and the count", () => spec.aFailedRowStaysWithItsError());
  it("a viewer sees Close only", () => spec.aViewerSeesCloseOnly());
  it("names the alarms beyond the list", () => spec.namesTheAlarmsBeyondTheList());
  it("the form and the run line die with their rows", () => spec.theFormAndTheRunLineDieWithTheirRows());
  it("the popup paints after the All alarms list", () => spec.thePopupComesAfterTheList());
  it("an unseen critical alarm blinks until closed or acknowledged; a warning never (U7)", () =>
    spec.anUnseenCriticalBlinksUntilClosedOrAcknowledged());
});
