import { describe, it } from "vitest";

import {
  runChangeDetectionTests,
  runFormErrorTests,
  runMalformedStoredEntryTests,
  runOperatorVocabularyTests,
  runOptionalKeysAreOmittedTests,
  runSeedTests,
  runThresholdZeroVersusEmptyTests,
  runVocabularyTests,
} from "./template-alarm-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template alarm form", () => {
  it("keeps a threshold of zero distinct from an empty one", () => {
    runThresholdZeroVersusEmptyTests();
  });

  it("omits an unset category, skill and philosophy rather than sending null", () => {
    runOptionalKeysAreOmittedTests();
  });

  it("offers exactly the operators the rule engine runs, each with a label", () => {
    runOperatorVocabularyTests();
  });

  it("seeds from the stored section, flattening philosophy into the row", () => {
    runSeedTests();
  });

  it("renders a malformed stored entry instead of throwing on it", () => {
    runMalformedStoredEntryTests();
  });

  it("catches blank fields, duplicate codes, unknown points and the section cap", () => {
    runFormErrorTests();
  });

  it("checks severity, category and skill against the live vocabularies", () => {
    runVocabularyTests();
  });

  it("treats a change as what would be sent", () => {
    runChangeDetectionTests();
  });
});
