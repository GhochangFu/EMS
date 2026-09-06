import { describe, it } from "vitest";

import {
  runTemplatePointDtoTests,
  runTemplatePointInsertFromBodyTests,
  runTemplatePointInsertFromRowTests,
} from "./asset-templates-point-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates point rows (F2.7 design decision 11)", () => {
  it("maps a stored row to the DTO exactly as mapPoint did, plus the five metadata fields", () => {
    runTemplatePointDtoTests();
  });

  it("maps a body to the insert exactly as replacePoints did", () => {
    runTemplatePointInsertFromBodyTests();
  });

  it("re-stamps a parent version's row onto the next version without losing a field", () => {
    runTemplatePointInsertFromRowTests();
  });
});
