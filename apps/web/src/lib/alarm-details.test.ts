import { describe, it } from "vitest";

import {
  runAlarmSkillLabelTests,
  runFormatThresholdPairingTests,
  runOperatorSymbolTests,
} from "./alarm-details.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("alarm-details", () => {
  it("renders every threshold operator (closed vocabulary, exhaustive switch)", () => {
    runOperatorSymbolTests();
  });

  it("pairs the current value with its threshold, or yields no pairing", () => {
    runFormatThresholdPairingTests();
  });

  it("resolves a skill label by code, falling back to the raw code", () => {
    runAlarmSkillLabelTests();
  });
});
