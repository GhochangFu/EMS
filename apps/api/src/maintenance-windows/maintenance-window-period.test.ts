import { describe, it } from "vitest";

import {
  aStartMoreThanAMinuteAgoFails,
  anExtensionMayCarryTheTotalPastSevenDays,
  anExtensionMustBeLater,
  sevenDaysIsTheBound,
  theEndFollowsTheStartAndNow,
} from "./maintenance-window-period.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 — the maintenance-window period rules (plan D3)", () => {
  it("exactly 7 days passes and 7 days + 1 ms fails", () => sevenDaysIsTheBound());
  it("a start more than 60 s in the past fails", () => aStartMoreThanAMinuteAgoFails());
  it("the end follows the start and now", () => theEndFollowsTheStartAndNow());
  it("an extension to now + 7 d passes on a window already 6 days long", () => anExtensionMayCarryTheTotalPastSevenDays());
  it("an extension must end later than the current end", () => anExtensionMustBeLater());
});
