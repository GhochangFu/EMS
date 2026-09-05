import { describe, it } from "vitest";

import {
  runBoundsTests,
  runClearAvailabilityTests,
  runColumnOriginTests,
  runD1IsCaughtBeforeSubmitTests,
  runDraftSeedingTests,
  runDraftToBodyTests,
  runEmptySubmitIsRefusedTests,
  runFieldRowTests,
  runRuntimePillLabelTests,
  runV2IsScheduledOnlyTests,
} from "./asset-point-calc-override.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("F2.6 — per-point calc override panel rules", () => {
  it("tells overridden, inherited and unset apart", () => {
    runColumnOriginTests();
  });

  it("disables Clear when there is nothing to clear", () => {
    runClearAvailabilityTests();
  });

  it("shows the template's value beside what actually runs", () => {
    runFieldRowTests();
  });

  it("seeds the form from the override only, never from the template", () => {
    runDraftSeedingTests();
  });

  it("sends empty as null, and the dialect only alongside a formula", () => {
    runDraftToBodyTests();
  });

  it("catches D-1 before submitting, in the same terms as the API", () => {
    runD1IsCaughtBeforeSubmitTests();
  });

  it("applies the shared bounds client-side too", () => {
    runBoundsTests();
  });

  it("refuses an empty form and points at Clear", () => {
    runEmptySubmitIsRefusedTests();
  });

  it("refuses a streaming override on a merged bms-calc-v2 point (ADR 0055 decision 10)", () => {
    runV2IsScheduledOnlyTests();
  });

  it("labels the calc-points status pill from what the engine last did (F2.9 Task 16)", () => {
    runRuntimePillLabelTests();
  });
});
