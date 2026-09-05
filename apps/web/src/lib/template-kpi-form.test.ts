import { describe, it } from "vitest";

import {
  runChangeDetectionTests,
  runFormErrorTests,
  runMalformedStoredEntryTests,
  runOptionalKeysAreOmittedTests,
  runPointKeyDerivationTests,
  runPointKeyResolutionTests,
  runSeedTests,
  runStoredV2KpiSurvivesTests,
  runValidateActionTests,
  runValidatedRowCannotSaveBrokenTests,
} from "./template-kpi-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template KPI form", () => {
  it("omits an unset unit and direction rather than sending null", () => {
    runOptionalKeysAreOmittedTests();
  });

  it("seeds from the stored section and starts a new KPI unvalidated", () => {
    runSeedTests();
  });

  it("keeps a stored bms-calc-v2 KPI's dialect when another KPI is edited", () => {
    runStoredV2KpiSurvivesTests();
  });

  it("derives pointKeys once validated and keeps the manual list before", () => {
    runPointKeyDerivationTests();
  });

  it("flips the dialect only when the expression validates", () => {
    runValidateActionTests();
  });

  it("catches blank fields, duplicate codes and the section cap", () => {
    runFormErrorTests();
  });

  it("refuses a KPI reading a point the template does not declare", () => {
    runPointKeyResolutionTests();
  });

  it("renders a malformed stored entry instead of throwing on it", () => {
    runMalformedStoredEntryTests();
  });

  it("never lets a validated KPI reach Save in a state the server refuses", () => {
    runValidatedRowCannotSaveBrokenTests();
  });

  it("treats a change as what would be sent", () => {
    runChangeDetectionTests();
  });
});
