import { describe, it } from "vitest";

import {
  flowingPillIsOpen,
  flowingWithAWarningLooksWarning,
  flowingWithNoAlarmLooksClosed,
  shutPillIsShut,
  shutWithACriticalAlarmLooksOpen,
  theBreakerPillsAreUnchanged,
} from "./mimic-breaker.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.80 — the flow tones' pills and looks (ADR 0101 d10, d11)", () => {
  it("BREAKER_PILL.flowing is OPEN", () => {
    flowingPillIsOpen();
  });

  it("BREAKER_PILL.shut is SHUT", () => {
    shutPillIsShut();
  });

  it("the breaker pills are unchanged", () => {
    theBreakerPillsAreUnchanged();
  });

  it("breakerLook(shut, critical) is open", () => {
    shutWithACriticalAlarmLooksOpen();
  });

  it("breakerLook(flowing, warning) is warning", () => {
    flowingWithAWarningLooksWarning();
  });

  it("breakerLook(flowing, null) is closed", () => {
    flowingWithNoAlarmLooksClosed();
  });
});
