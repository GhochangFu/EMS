import { describe, it } from "vitest";

import {
  aFieldThatIsNotANumberIsRefused,
  aTickedEmptyFieldClearsTheStoredValue,
  activeFalseIsAValueNotAnAbsence,
  anUntickedFieldIsAbsentFromThePatch,
  theThreeProblemsAreNamed,
} from "./asset-point-bulk-edit.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the asset-point bulk editor's draft (ADR 0056 decision 8)", () => {
  it("leaves an unticked field out of the patch", () => {
    anUntickedFieldIsAbsentFromThePatch();
  });

  it("clears a ticked but empty field back to the template default", () => {
    aTickedEmptyFieldClearsTheStoredValue();
  });

  it("treats active false as a value, not an absence", () => {
    activeFalseIsAValueNotAnAbsence();
  });

  it("names the three problems before anything is sent", () => {
    theThreeProblemsAreNamed();
  });

  it("refuses a ticked number field that does not hold a number", () => {
    aFieldThatIsNotANumberIsRefused();
  });
});
