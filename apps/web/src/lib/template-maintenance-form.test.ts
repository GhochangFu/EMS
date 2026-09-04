import { describe, it } from "vitest";

import {
  runBlankRowTests,
  runEstimatedMinutesBoundsTests,
  runIntervalDaysBoundsTests,
  runNonArrayStoredSectionTests,
  runOptionalStringBoundsTests,
  runPayloadShapeTests,
  runReadBackIsNeverDirtyTests,
  runSectionCapTests,
  runSeedsEveryApiDefaultTests,
  runTitleBoundsTests,
  runRepairingARetiredEnumReadsAsAChangeTests,
  runVocabularyIdentityTests,
  runVocabularyMembershipTests,
} from "./template-maintenance-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template maintenance form", () => {
  it("seeds every field the API defaults", () => {
    runSeedsEveryApiDefaultTests();
  });

  it("seeds no rows from a stored section that is not an array", () => {
    runNonArrayStoredSectionTests();
  });

  it("gives a new plan the same defaults with nothing authored", () => {
    runBlankRowTests();
  });

  it("holds the title to 3–255 characters", () => {
    runTitleBoundsTests();
  });

  it("holds intervalDays to a whole number of days, 1–730", () => {
    runIntervalDaysBoundsTests();
  });

  it("holds estimatedMinutes to a whole number of minutes, 5–1440", () => {
    runEstimatedMinutesBoundsTests();
  });

  it("holds every optional string to its own length limit", () => {
    runOptionalStringBoundsTests();
  });

  it("refuses a value outside a closed vocabulary, naming the field", () => {
    runVocabularyMembershipTests();
  });

  it("reports the 200-entry section cap as a section problem", () => {
    runSectionCapTests();
  });

  it("sends numbers as numbers and an emptied optional string as an absent key", () => {
    runPayloadShapeTests();
  });

  it("reads a stored plan back without reporting it as an unsaved change", () => {
    runReadBackIsNeverDirtyTests();
  });

  it("takes the three vocabularies from the contract's own enums, by identity", () => {
    runVocabularyIdentityTests();
  });

  it("reads repairing a retired enum with the API's own default as a change", () => {
    runRepairingARetiredEnumReadsAsAChangeTests();
  });
});
