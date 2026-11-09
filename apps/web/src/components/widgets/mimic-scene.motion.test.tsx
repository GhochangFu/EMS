// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFanOutUnitBlinksWhenAnyMemberTrips,
  aLiveUnitBreathesAndTheQuietStatesStayStill,
  aTrippedSingleBreakerBlinksItsContact,
  anAlarmPulsesFastOnlyWhenCritical,
  onlyTheUnitGlyphMoves,
  withoutTheMotionPropNothingMoves,
} from "./mimic-scene.motion.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2). jsdom evaluates no
 * media query and no animation: these claims hold `data-motion` and the class; the reduced-motion
 * and cycle-rate proofs are `tests/f4.344-mimic-motion-gate.test.ts` MG1–MG3.
 */
describe("F4.344 — MimicScene animates each unit's glyph by its state (ADR 0120)", () => {
  afterEach(() => {
    cleanup();
  });

  it("SM1 a live unit breathes; unassigned, no asset, none and stale stay still", () => {
    aLiveUnitBreathesAndTheQuietStatesStayStill();
  });
  it("SM2 an alarm pulses, fast only when its top alarm's tone is critical", () => {
    anAlarmPulsesFastOnlyWhenCritical();
  });
  it("SM3 a tripped single breaker blinks its contact, over a critical alarm too", () => {
    aTrippedSingleBreakerBlinksItsContact();
  });
  it("SM4 a fan-out unit blinks when any member trips; its member rows stay still", () => {
    aFanOutUnitBlinksWhenAnyMemberTrips();
  });
  it("SM5 without the motion prop nothing moves", () => {
    withoutTheMotionPropNothingMoves();
  });
  it("SM6 only the unit glyph moves — never the pump, sink, callout or a passive unit", () => {
    onlyTheUnitGlyphMoves();
  });
});
