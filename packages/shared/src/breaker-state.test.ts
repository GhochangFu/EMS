import { describe, it } from "vitest";

import {
  aNullLatestIsUnknown,
  aThirdKeysTrippedRowWins,
  anUnmappedValueIsUnknown,
  breakerRoleCodesAreTheFive,
  breakerSymbolSwitches,
  libraryBreakersSwitchAndExist,
  mainOneIsClosed,
  mainZeroIsOpen,
  openBeatsClosed,
  staleBeatsAClosedValue,
  switchboardDoesNotSwitch,
  tripBeatsClosed,
} from "./breaker-state.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 — deriveBreakerState (ADR 0088, plan D3)", () => {
  it("answers offline for a stale asset whose value maps to closed", () => {
    staleBeatsAClosedValue();
  });

  it("answers tripped for breaker_trip 1 beside breaker_main 1", () => {
    tripBeatsClosed();
  });

  it("answers open when an open tone sits beside a closed one", () => {
    openBeatsClosed();
  });

  it("answers open for breaker_main 0", () => {
    mainZeroIsOpen();
  });

  it("answers closed for breaker_main 1", () => {
    mainOneIsClosed();
  });

  it("answers unknown for a value with no map row", () => {
    anUnmappedValueIsUnknown();
  });

  it("answers unknown for a null latest sample", () => {
    aNullLatestIsUnknown();
  });

  it("lets a third key's tripped row win", () => {
    aThirdKeysTrippedRowWins();
  });
});

describe("F3.74 — the switching symbols and the breaker roles (ADR 0088, plan D1b, D10)", () => {
  it("switches on the breaker glyph", () => {
    breakerSymbolSwitches();
  });

  it("does not switch on a switchboard or an absent symbol", () => {
    switchboardDoesNotSwitch();
  });

  it("switches on the two library breakers, and every listed key exists", () => {
    libraryBreakersSwitchAndExist();
  });

  it("lists the five breaker roles in sort order", () => {
    breakerRoleCodesAreTheFive();
  });
});
