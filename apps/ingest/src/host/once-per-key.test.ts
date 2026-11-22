import { describe, it } from "vitest";

import {
  assertAKeyIsTrueOnlyTheFirstTime,
  assertANamedReloadSkipIsLoggedOnce,
  assertAWarningFirstSeenAtAReloadIsReported,
  assertAnIntervalLineNamesTheLevelAndNoValue,
  assertAnUnchangedWarningIsReportedOnce,
  assertEachReasonAndLevelIsItsOwnKey,
} from "./once-per-key.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — plan warnings once per process (plan T3.7)", () => {
  it("O1 a key is new only the first time", () => assertAKeyIsTrueOnlyTheFirstTime());
  it("O2 an unchanged warning is reported once across reloads", () => assertAnUnchangedWarningIsReportedOnce());
  it("O3 a warning first seen at a reload is reported", () => assertAWarningFirstSeenAtAReloadIsReported());
  it("O4 each reason and level is its own key", () => assertEachReasonAndLevelIsItsOwnKey());
  it("O5 an interval line names the level and no value", () => assertAnIntervalLineNamesTheLevelAndNoValue());
  it("O6 a named skip first seen at a reload is logged once (ADR 0141 decision 22)", () => assertANamedReloadSkipIsLoggedOnce());
});
