import { describe, it } from "vitest";

import * as spec from "./alarm-tone.spec";

/** `F4.357` U8 — Vitest entry point. Assertions live in `alarm-tone.spec.ts` (ADR 0014). */
describe("alarm tone (F4.357, ADR 0130 decision 10)", () => {
  it("a running context plays two oscillator beeps", () => spec.aRunningContextPlays());
  it("a suspended context is blocked and makes no sound", () => spec.aSuspendedContextIsBlocked());
  it("unlock resumes the context", () => spec.unlockResumes());
  it("no Web Audio is blocked", () => spec.noWebAudioIsBlocked());
});
