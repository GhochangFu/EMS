// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aBreakerGlyphWithNoStatePointsDrawsAsBefore,
  aClosedBreakerWithACriticalAlarmFramesCritical,
  aClosedFanOutMemberWithACriticalAlarmFramesCritical,
  aStaleBreakerGlyphWithNoStatePointsIsNotOffline,
  anOpenFanOutMemberWithACriticalAlarmFramesOpen,
  aFanOutUnitDrawsOneRowPerMember,
  aFullyDrawnFanOutShowsNoMore,
  aLayoutFanOutBreakerDrawsMemberRows,
  aNonSwitchingUnitWithStatePointsDrawsNoSwitch,
  aPassiveBusFramesAsItsWorstDownstreamSwitch,
  aPassiveBusOverClosedSwitchesFramesClosed,
  aPassiveUnitWithNoDownstreamSwitchStaysPassive,
  aSingleBreakerUnitCarriesItsOwnState,
  aSocketReadingFlipsThePill,
  aStaleMemberIsOfflineNeverClosed,
  anOpenBreakerWithACriticalAlarmFramesOpen,
  breakerMainOneIsClosed,
  breakerMainZeroIsOpen,
  breakerTripOneIsTripped,
  compactHidesValuesAndCalloutsKeepsSwitches,
  notCompactDrawsValuesAndCallouts,
  seventeenMembersDrawSixteenAndOneMore,
} from "./mimic-scene.breakers.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2). One claim per `it()`.
 */
describe("F3.74 Task 3.1 — MimicScene breakers", () => {
  afterEach(() => {
    cleanup();
  });

  it("S1a breaker_main 1 reads CLOSED", () => {
    breakerMainOneIsClosed();
  });
  it("S1b breaker_main 0 reads OPEN", () => {
    breakerMainZeroIsOpen();
  });
  it("S1c breaker_trip 1 reads TRIPPED over a CLOSED breaker_main", () => {
    breakerTripOneIsTripped();
  });
  it("S1d a non-fan-out breaker unit carries its own switch and pill", () => {
    aSingleBreakerUnitCarriesItsOwnState();
  });
  it("S2 a socket reading flips the pill without a refetch", () => {
    aSocketReadingFlipsThePill();
  });
  it("S3 a stale member is OFFLINE, never CLOSED", () => {
    aStaleMemberIsOfflineNeverClosed();
  });
  it("S4 a fan-out unit draws one row per member in code order and no value rows", () => {
    aFanOutUnitDrawsOneRowPerMember();
  });
  it("S5 seventeen members draw sixteen rows and +1 more", () => {
    seventeenMembersDrawSixteenAndOneMore();
  });
  it("S5b a fully drawn fan-out shows no +N more", () => {
    aFullyDrawnFanOutShowsNoMore();
  });
  it("S6a a CLOSED breaker with a critical alarm frames critical and keeps the alarm", () => {
    aClosedBreakerWithACriticalAlarmFramesCritical();
  });
  it("S6b an OPEN breaker with a critical alarm frames open and keeps the alarm", () => {
    anOpenBreakerWithACriticalAlarmFramesOpen();
  });
  it("S7a not compact draws value rows and callouts", () => {
    notCompactDrawsValuesAndCallouts();
  });
  it("S7b compact hides value rows and callouts and keeps switches and pills", () => {
    compactHidesValuesAndCalloutsKeepsSwitches();
  });
  it("S8 a passive bus frames as its worst downstream switch", () => {
    aPassiveBusFramesAsItsWorstDownstreamSwitch();
  });
  it("S8b a passive bus over closed switches frames closed", () => {
    aPassiveBusOverClosedSwitchesFramesClosed();
  });
  it("S9 a passive unit with no downstream switch stays passive", () => {
    aPassiveUnitWithNoDownstreamSwitchStaysPassive();
  });
  it("S10 a non-switching unit with state points draws no switch", () => {
    aNonSwitchingUnitWithStatePointsDrawsNoSwitch();
  });
  it("S11 a layout fan-out breaker draws member rows (arm parity)", () => {
    aLayoutFanOutBreakerDrawsMemberRows();
  });
  it("S6c a CLOSED fan-out member with a critical alarm frames its row critical", () => {
    aClosedFanOutMemberWithACriticalAlarmFramesCritical();
  });
  it("S6d an OPEN fan-out member with a critical alarm frames its row open", () => {
    anOpenFanOutMemberWithACriticalAlarmFramesOpen();
  });
  it("S12a a breaker glyph with no state points draws as before", () => {
    aBreakerGlyphWithNoStatePointsDrawsAsBefore();
  });
  it("S12b a stale breaker glyph with no state points is not OFFLINE", () => {
    aStaleBreakerGlyphWithNoStatePointsIsNotOffline();
  });
});
