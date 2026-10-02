// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aClosedBreakerDoesNotShowItsTripCause,
  aNullRatingPrintsADash,
  anAlarmedClosedBreakerReadsCritical,
  anAlarmedClosedBreakerReadsWarning,
  anAlarmedClosedBreakerShowsTheAlarmLabel,
  anOpenBreakerWithAnAlarmStaysOpen,
  anOpenBreakerShowsItsTripCause,
  anOpenBreakerWithNoTripCauseShowsADash,
  anUnknownStateIsADashNeverClosed,
  anUnknownStateWithAWarningStaysADash,
  aSocketReadingFlipsTheState,
  aSocketReadingUpdatesTheCurrent,
  aStaleBreakerIsOffline,
  aStaleBreakersReadingsAreDashes,
  aStaleBreakersTripCauseIsADash,
  aStaticDrawShowsTheEmptyLine,
  aTableWithRowsHasNoEmptyLine,
  aTrippedBreakerShowsItsTripCause,
  breakerMainOneReadsClosed,
  breakerTripOneReadsTripped,
  noBreakersDrawsTheEmptyLine,
  positionIsTheRoleLabelAndRatingTheAssets,
  rowsKeepTheResponseOrder,
} from "./breaker-table-widget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2). One claim per `it()`.
 */
describe("F3.74 Task 4.3 — BreakerTableWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("T1a breaker_main 1 reads CLOSED", () => {
    breakerMainOneReadsClosed();
  });
  it("T1b breaker_trip 1 reads TRIPPED", () => {
    breakerTripOneReadsTripped();
  });
  it("T1c a TRIPPED breaker shows its tripCause", () => {
    aTrippedBreakerShowsItsTripCause();
  });
  it("T1d a CLOSED breaker does not show its tripCause", () => {
    aClosedBreakerDoesNotShowItsTripCause();
  });
  it("T2a an OPEN breaker shows its tripCause", () => {
    anOpenBreakerShowsItsTripCause();
  });
  it("T2b an OPEN breaker with no tripCause shows a dash", () => {
    anOpenBreakerWithNoTripCauseShowsADash();
  });
  it("T3a a stale breaker is OFFLINE", () => {
    aStaleBreakerIsOffline();
  });
  it("T3b a stale breaker's readings are dashes", () => {
    aStaleBreakersReadingsAreDashes();
  });
  it("T3c a stale breaker's Trip Cause is a dash", () => {
    aStaleBreakersTripCauseIsADash();
  });
  it("T4a an alarmed CLOSED breaker reads CRITICAL", () => {
    anAlarmedClosedBreakerReadsCritical();
  });
  it("T4b an alarmed CLOSED breaker reads WARN", () => {
    anAlarmedClosedBreakerReadsWarning();
  });
  it("T4c an alarmed CLOSED breaker shows the alarm label", () => {
    anAlarmedClosedBreakerShowsTheAlarmLabel();
  });
  it("T4d an OPEN breaker with an alarm stays OPEN", () => {
    anOpenBreakerWithAnAlarmStaysOpen();
  });
  it("T5a a socket reading updates the current", () => {
    aSocketReadingUpdatesTheCurrent();
  });
  it("T5b a socket reading flips the state", () => {
    aSocketReadingFlipsTheState();
  });
  it("T6a Position is the role label and Rating the asset's", () => {
    positionIsTheRoleLabelAndRatingTheAssets();
  });
  it("T6b a null rating prints a dash", () => {
    aNullRatingPrintsADash();
  });
  it("T7a an unknown state is a dash, never CLOSED", () => {
    anUnknownStateIsADashNeverClosed();
  });
  it("T7b an unknown state with a warning alarm stays a dash", () => {
    anUnknownStateWithAWarningStaysADash();
  });
  it("T8 the rows keep the response order", () => {
    rowsKeepTheResponseOrder();
  });
  it("T9a no breakers draws the empty line", () => {
    noBreakersDrawsTheEmptyLine();
  });
  it("T9b a static draw shows the empty line", () => {
    aStaticDrawShowsTheEmptyLine();
  });
  it("T9c a table with rows has no empty line", () => {
    aTableWithRowsHasNoEmptyLine();
  });
});
